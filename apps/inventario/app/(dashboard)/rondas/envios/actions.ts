'use server'

// Escrituras del envío masivo y del menú del bot (Puntos QR F10).
//
// TODO VA POR RPC, no por la tabla. Las tres tablas de F10 tienen RLS de
// LECTURA y ninguna política de escritura, igual que las de F9: así no hay forma
// de armar un envío saltándose las comprobaciones (el permiso, el alcance de
// contratos, que el contrato permita WhatsApp, que una emergencia diga quién la
// autorizó y por qué) ni, sobre todo, de encolar un mensaje sin pasar por el
// portero.
//
// Las RPC comprueban el permiso por dentro, con `auth.uid()` de la sesión. Lo de
// aquí es traducir errores y revalidar la ruta.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { caudalConfigurado } from '@/lib/whatsapp/caudal'
import {
  faltaEnAudiencia, normalizarAudiencia, variablesDeTexto, ES_UUID,
} from '@/lib/envios/audiencia'

export interface ActionResult {
  error?: string
  ok?: boolean
  /** El id del envío creado, para que la pantalla pueda seguir con él. */
  envioId?: string
  /** El desglose de la audiencia, tal como lo devolvió la base. */
  resumen?: Record<string, unknown>
}

const PERMISO = 'gestionar_envios_whatsapp'
const PERMISO_MENU = 'gestionar_menu_whatsapp'
const RUTA = '/rondas/envios'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function cliente() {
  return (await createClient()) as any
}

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}

function lista(fd: FormData, campo: string): string[] {
  return fd
    .getAll(campo)
    .map((v) => String(v).trim())
    .filter((v) => v !== '')
}

function traducir(msg: string): string {
  if (msg.includes('no tiene habilitada')) {
    return 'Ese contrato no tiene habilitada la mensajería por WhatsApp. Se activa en su ficha de contrato.'
  }
  if (msg.includes('gestionar_whatsapp')) {
    return 'Un envío fuera de jornada (emergencia) lo tiene que autorizar quien administra el canal de WhatsApp.'
  }
  if (msg.includes('ck_crm_envio_cuerpo')) return 'Falta el mensaje: escribí un texto o elegí una plantilla.'
  if (msg.includes('ck_crm_envio_alcance')) {
    return 'Falta decir a quién: elegí las sedes, las personas o la lista, según el alcance.'
  }
  if (msg.includes('ck_crm_envio_emergencia')) {
    return 'Una emergencia tiene que decir por qué, y quién la autoriza tiene que estar en sesión.'
  }
  if (msg.includes('vacía')) {
    return 'La audiencia quedó vacía: nadie del contrato tiene WhatsApp verificado y permiso de mensajería.'
  }
  if (msg.includes('10 opciones')) {
    return 'El menú ya tiene 10 opciones activas, que es el máximo de una lista de WhatsApp.'
  }
  if (msg.includes('ux_crm_menu_orden')) return 'Ya hay otra opción con ese orden en el mismo menú.'
  if (msg.includes('ck_crm_menu_texto')) return 'Una opción de tipo «texto fijo» necesita el texto.'
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese contrato no está en tu alcance.'
  }
  if (msg.includes('permiso')) return msg
  return msg
}

/** Crea el envío en BORRADOR. Todavía no se le escribe a nadie. */
export async function crearEnvio(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const grupo = texto(fd, 'grupo_id')
  if (!grupo || !ES_UUID.test(grupo)) return { error: 'Falta el contrato.' }
  const nombre = texto(fd, 'nombre')
  if (!nombre) return { error: 'Ponele un nombre al envío, para poder reconocerlo después.' }

  // La audiencia se normaliza y se comprueba ACÁ, con las mismas reglas que el
  // CHECK de la tabla: un envío «a estas sedes» sin sedes tiene que corregirse
  // en el formulario, no guardarse para fallar después.
  const audiencia = normalizarAudiencia({
    alcance: texto(fd, 'alcance'),
    sedes: lista(fd, 'sedes'),
    cargos: lista(fd, 'cargos'),
    turno: texto(fd, 'turno'),
    lista: texto(fd, 'lista'),
    // Las personas sueltas llegan como líneas de un campo de texto.
    personas: (texto(fd, 'personas') ?? '').split('\n'),
  })
  const faltaAudiencia = faltaEnAudiencia(audiencia)
  if (faltaAudiencia) return { error: faltaAudiencia }

  const emergencia = fd.get('es_emergencia') === 'on'
  const sb = await cliente()
  const { data, error } = await sb.rpc('crm_envio_crear', {
    p_grupo: grupo,
    p_nombre: nombre,
    p_tipo: texto(fd, 'tipo') ?? 'AVISO',
    p_alcance: audiencia.alcance,
    p_sedes: audiencia.sedes,
    p_cargos: audiencia.cargos,
    p_turno: audiencia.turno,
    p_lista: audiencia.lista,
    p_personas: audiencia.personas,
    p_plantilla: texto(fd, 'plantilla'),
    // Las variables llegan como líneas: una por variable, en orden.
    p_variables: variablesDeTexto(texto(fd, 'variables')),
    p_texto: texto(fd, 'texto'),
    p_prioridad: Number(texto(fd, 'prioridad') ?? '8') || 8,
    p_programado: texto(fd, 'programado'),
    p_escalon_mps: texto(fd, 'escalon_mps') ? Number(texto(fd, 'escalon_mps')) : null,
    p_emergencia: emergencia,
    p_emergencia_motivo: texto(fd, 'emergencia_motivo'),
    p_costo_unitario: texto(fd, 'costo_unitario') ? Number(texto(fd, 'costo_unitario')) : null,
  })
  if (error) return { error: traducir(error.message) }

  const fila = Array.isArray(data) ? data[0] : data
  revalidatePath(RUTA)
  return { ok: true, envioId: fila?.id }
}

/**
 * Calcula la audiencia: una fila por persona, con su motivo si queda fuera.
 *
 * Es el paso que el §4.1 pide ANTES de confirmar: devuelve cuántos entran,
 * cuántos no y por qué, y con eso la pantalla muestra el costo estimado.
 */
export async function calcularAudiencia(envioId: string): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(envioId)) return { error: 'Envío no válido.' }

  const sb = await cliente()
  const { data, error } = await sb.rpc('crm_envio_resolver', { p_envio: envioId })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true, resumen: (data ?? {}) as Record<string, unknown> }
}

/**
 * Aprueba el envío y reparte la hora de cada destino.
 *
 * El caudal se le pasa desde la aplicación (`WHATSAPP_THROUGHPUT_MPS`) para que
 * la base reparta con el MISMO número con el que el buzón de salida va a
 * enviar: si no, el reparto prometería un ritmo que la cola no sostiene.
 */
export async function aprobarEnvio(envioId: string, desde?: string | null): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(envioId)) return { error: 'Envío no válido.' }

  const sb = await cliente()
  const { error } = await sb.rpc('crm_envio_aprobar', {
    p_envio: envioId,
    p_desde: desde ?? null,
    p_mps_tope: caudalConfigurado(),
  })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function cancelarEnvio(envioId: string, motivo: string | null): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(envioId)) return { error: 'Envío no válido.' }

  const sb = await cliente()
  const { error } = await sb.rpc('crm_envio_cancelar', { p_envio: envioId, p_motivo: motivo })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export interface DestinoFila {
  id: string
  estado: string
  exclusion_motivo: string | null
  omitido_motivo: string | null
  canal_valor: string | null
  es_emergencia: boolean
  programado_para: string | null
  aplazos: number
  error: string | null
  enviado_at: string | null
  leido_at: string | null
  persona: { nombres: string; apellidos: string; cargo: string | null } | null
}

/**
 * Los destinos de un envío, paginados.
 *
 * Nunca se traen todos: un envío a una sede son miles de filas y Supabase corta
 * a los 8 segundos. Los TOTALES ya los da `crm_envios_resumen`, contados en SQL;
 * esto es para mirar casos concretos.
 */
export async function destinosDeEnvio(
  envioId: string,
  opciones: { estado?: string | null; desde?: number; limite?: number } = {},
): Promise<{ error?: string; filas?: DestinoFila[] }> {
  const falta = await faltaPermiso('ver_envios_whatsapp')
  if (falta) return { error: falta }
  if (!ES_UUID.test(envioId)) return { error: 'Envío no válido.' }

  const desde = Math.max(opciones.desde ?? 0, 0)
  const limite = Math.min(Math.max(opciones.limite ?? 50, 1), 200)
  const sb = await cliente()
  let q = sb
    .from('crm_envio_destinos')
    .select(`id, estado, exclusion_motivo, omitido_motivo, canal_valor, es_emergencia,
             programado_para, aplazos, error, enviado_at, leido_at,
             persona:personas ( nombres, apellidos, cargo )`)
    .eq('envio_id', envioId)
    .order('estado')
    .order('programado_para', { ascending: true, nullsFirst: false })
    .order('id')
    .range(desde, desde + limite - 1)
  if (opciones.estado) q = q.eq('estado', opciones.estado)

  const { data, error } = await q
  if (error) return { error: error.message }
  return { filas: (data ?? []) as DestinoFila[] }
}

/* ── El menú del bot ───────────────────────────────────────────────────────── */

export async function guardarOpcionMenu(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO_MENU)
  if (falta) return { error: falta }

  const etiqueta = texto(fd, 'etiqueta')
  if (!etiqueta) return { error: 'La opción necesita una etiqueta: es lo que se lee en la lista.' }
  const id = texto(fd, 'id')
  const grupo = texto(fd, 'grupo_id')
  if (grupo && !ES_UUID.test(grupo)) return { error: 'Contrato no válido.' }

  const sb = await cliente()
  const { error } = await sb.rpc('crm_menu_guardar', {
    p_id: id && ES_UUID.test(id) ? id : null,
    p_grupo: grupo,
    p_cargo: texto(fd, 'cargo'),
    p_orden: Number(texto(fd, 'orden') ?? '1') || 1,
    p_etiqueta: etiqueta,
    p_desc: texto(fd, 'descripcion'),
    p_accion: texto(fd, 'accion') ?? 'AYUDA',
    p_texto: texto(fd, 'texto'),
    p_permiso: texto(fd, 'requiere_permiso'),
    p_activo: fd.get('activo') !== 'off',
  })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function borrarOpcionMenu(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO_MENU)
  if (falta) return { error: falta }
  if (!ES_UUID.test(id)) return { error: 'Opción no válida.' }

  const sb = await cliente()
  const { error } = await sb.rpc('crm_menu_borrar', { p_id: id })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}
