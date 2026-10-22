'use server'

// Escrituras del contrato de conserjería (F1 del módulo de Puntos QR).
//
// Van por server action + RLS, no por RPC: no hay máquina de estados ni
// bitácora que proteger, y la política de la migración ya exige
// `gestionar_contratos_conserjeria` MÁS el contrato en el alcance
// (`auth_grupos()`). `faltaPermiso` está igual para dar un mensaje legible en
// vez del crudo "row-level security".

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import {
  ESTADOS_CONTRATO, SERVICIOS_CONTRATO, TIPOS_VIGENCIA,
  type EstadoContrato, type ServicioContrato, type TipoVigencia,
} from '@/lib/contratos-conserjeria'

export interface ActionResult { error?: string; ok?: boolean }

const PERMISO = 'gestionar_contratos_conserjeria'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function fecha(fd: FormData, campo: string): string | null {
  const s = texto(fd, campo)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function entero(fd: FormData, campo: string, porDefecto: number): number {
  const n = Number(texto(fd, campo))
  return Number.isFinite(n) ? Math.round(n) : porDefecto
}
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true'

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese contrato no está en tu alcance.'
  }
  if (msg.includes('grupos_contrato_vigencia_chk')) {
    return 'La fecha de fin no puede ser anterior a la de inicio.'
  }
  if (msg.includes('idx_grupos_contrato_numero')) {
    return 'Ya hay otro contrato con ese número.'
  }
  return 'No se pudo guardar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

/** Datos del contrato: cliente, número, objeto, vigencia, estado y arte. */
export async function guardarContrato(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = String(fd.get('id') ?? '')
  if (!id) return { error: 'Contrato no especificado.' }

  const estado = String(fd.get('estado') ?? '') as EstadoContrato
  if (!ESTADOS_CONTRATO.includes(estado)) return { error: 'Estado no válido.' }

  const desde = fecha(fd, 'vigencia_desde')
  const hasta = fecha(fd, 'vigencia_hasta')
  if (desde && hasta && hasta < desde) return { error: 'La fecha de fin no puede ser anterior a la de inicio.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error } = await sb.from('grupos_contrato').update({
    nombre: texto(fd, 'nombre') ?? undefined,
    cliente_id: texto(fd, 'cliente_id'),
    numero: texto(fd, 'numero'),
    objeto: texto(fd, 'objeto'),
    vigencia_desde: desde,
    vigencia_hasta: hasta,
    estado,
    arte_color: texto(fd, 'arte_color'),
    idioma_reportes: texto(fd, 'idioma_reportes') ?? 'es-CO',
  }).eq('id', id)
  if (error) return { error: traducir(error.message) }

  revalidatePath('/rondas/contratos')
  revalidatePath(`/rondas/contratos/${id}`)
  return { ok: true }
}

/** Servicios contratados: se guarda la lista completa de los marcados. */
export async function guardarServicios(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = String(fd.get('id') ?? '')
  if (!id) return { error: 'Contrato no especificado.' }

  const pedidos = fd.getAll('servicio').map(String)
    .filter((s): s is ServicioContrato => SERVICIOS_CONTRATO.includes(s as ServicioContrato))

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // Se marcan activos los pedidos y se desactivan los demás, en vez de borrar
  // filas: las fechas y la observación de un servicio que se suspende valen.
  if (pedidos.length) {
    const { error } = await sb.from('grupo_servicios')
      .upsert(pedidos.map((servicio) => ({ grupo_id: id, servicio, activo: true })),
        { onConflict: 'grupo_id,servicio' })
    if (error) return { error: traducir(error.message) }
  }
  const sobran = SERVICIOS_CONTRATO.filter((s) => !pedidos.includes(s))
  if (sobran.length) {
    const { error } = await sb.from('grupo_servicios')
      .update({ activo: false }).eq('grupo_id', id).in('servicio', sobran)
    if (error) return { error: traducir(error.message) }
  }

  revalidatePath(`/rondas/contratos/${id}`)
  return { ok: true }
}

/** Reglas del contrato. Si no hay fila todavía, la crea. */
export async function guardarReglas(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = String(fd.get('id') ?? '')
  if (!id) return { error: 'Contrato no especificado.' }

  const meses = entero(fd, 'retencion_evidencia_meses', 12)
  if (meses < 1 || meses > 120) return { error: 'La retención debe estar entre 1 y 120 meses.' }
  const radio = entero(fd, 'geocerca_radio_m', 50)
  if (radio < 5 || radio > 5000) return { error: 'El radio de geocerca debe estar entre 5 y 5.000 metros.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error } = await sb.from('grupo_reglas').upsert({
    grupo_id: id,
    // El dominio de nivel_antifraude lo cierra el complemento 1: aquí es texto
    // libre a propósito (ver el comentario de la columna en la migración).
    nivel_antifraude: texto(fd, 'nivel_antifraude'),
    permite_whatsapp: marcado(fd, 'permite_whatsapp'),
    pqrs_publico: marcado(fd, 'pqrs_publico'),
    comparte_seguimiento_vivo: marcado(fd, 'comparte_seguimiento_vivo'),
    mensajeria_desde: texto(fd, 'mensajeria_desde'),
    mensajeria_hasta: texto(fd, 'mensajeria_hasta'),
    retencion_evidencia_meses: meses,
    geocerca_radio_m: radio,
  }, { onConflict: 'grupo_id' })
  if (error) return { error: traducir(error.message) }

  revalidatePath(`/rondas/contratos/${id}`)
  return { ok: true }
}

/** Agrega un periodo de vigencia (prórroga, renovación u otrosí). */
export async function agregarVigencia(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = String(fd.get('id') ?? '')
  if (!id) return { error: 'Contrato no especificado.' }

  const desde = fecha(fd, 'desde')
  if (!desde) return { error: 'La fecha de inicio del periodo es obligatoria.' }
  const hasta = fecha(fd, 'hasta')
  if (hasta && hasta < desde) return { error: 'La fecha de fin no puede ser anterior a la de inicio.' }
  const tipo = String(fd.get('tipo') ?? 'PRORROGA') as TipoVigencia
  if (!TIPOS_VIGENCIA.includes(tipo)) return { error: 'Tipo de periodo no válido.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error } = await sb.from('grupo_vigencias')
    .insert({ grupo_id: id, desde, hasta, tipo, motivo: texto(fd, 'motivo') })
  if (error) {
    if (error.message.includes('idx_grupo_vigencias_periodo')) {
      return { error: 'Ya hay un periodo de ese tipo que empieza ese día.' }
    }
    return { error: traducir(error.message) }
  }

  revalidatePath('/rondas/contratos')
  revalidatePath(`/rondas/contratos/${id}`)
  return { ok: true }
}

/**
 * Borra un periodo de vigencia (se registró por error). El contrato se lee de
 * la fila, no del formulario: DeleteButton solo manda `id`, y de todos modos
 * fiarse del `grupo_id` del cliente para revalidar sería de más.
 */
export async function eliminarVigencia(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return

  const { sb, user } = await cliente()
  if (!user) return
  const { data: fila } = await sb.from('grupo_vigencias').select('grupo_id').eq('id', id).maybeSingle()
  await sb.from('grupo_vigencias').delete().eq('id', id)
  revalidatePath('/rondas/contratos')
  if (fila?.grupo_id) revalidatePath(`/rondas/contratos/${fila.grupo_id}`)
}
