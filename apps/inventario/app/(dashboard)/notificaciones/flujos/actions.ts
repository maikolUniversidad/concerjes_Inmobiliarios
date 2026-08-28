'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAdmin } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { slug } from '@/lib/email/plantillas'
import { procesarFlujosPendientes } from '@/lib/notificaciones/worker'
import type { Condiciones, DestinatariosPaso, TipoPasoFlujo, VerificacionPaso } from '@/lib/types/database'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const RUTA = '/notificaciones/flujos'
const TIPOS: TipoPasoFlujo[] = ['EMAIL', 'APP', 'ESPERA', 'WEBHOOK']
const SEVERIDADES = ['INFO', 'EXITO', 'ADVERTENCIA', 'CRITICA']

async function auth(permiso = 'gestionar_flujos_notificacion') {
  const supabase = await createClient() as DB
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, error: 'Debes iniciar sesión.' }
  const permisos = await getPermisosUsuario()
  if (!permisos.puede(permiso)) return { supabase, user, error: 'No tienes permiso para esta acción.' }
  return { supabase, user, error: null }
}

/** Lee un campo JSON del formulario con un valor por defecto si viene corrupto. */
function leerJson<T>(formData: FormData, campo: string, porDefecto: T): T {
  const crudo = String(formData.get(campo) ?? '').trim()
  if (!crudo) return porDefecto
  try {
    return JSON.parse(crudo) as T
  } catch {
    return porDefecto
  }
}

function mensajeError(error: { message: string }, contexto: string): string {
  if (/duplicate key/i.test(error.message)) return 'Ya existe un registro con ese código.'
  if (/row-level security|permission/i.test(error.message)) return 'No tienes permiso para esta acción.'
  return `${contexto}: ${error.message}`
}

// ── Flujos ───────────────────────────────────────────────────────────────────

/** Crea o actualiza un flujo (el disparador y sus condiciones). */
export async function guardarFlujo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user, error: authError } = await auth()
  if (authError) return { error: authError }

  const id = String(formData.get('id') ?? '').trim() || null
  const nombre = String(formData.get('nombre') ?? '').trim()
  const evento_codigo = String(formData.get('evento_codigo') ?? '').trim()

  if (nombre.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres.' }
  if (!evento_codigo) return { error: 'Elige el evento que dispara el flujo.' }

  const prioridad = Number(formData.get('prioridad'))
  const fila = {
    codigo: String(formData.get('codigo') ?? '').trim() || slug(nombre),
    nombre,
    descripcion: String(formData.get('descripcion') ?? '').trim() || null,
    evento_codigo,
    condiciones: leerJson<Condiciones>(formData, 'condiciones', { modo: 'AND', reglas: [] }),
    activo: formData.get('activo') === 'on',
    prioridad: Number.isFinite(prioridad) && prioridad > 0 ? Math.floor(prioridad) : 100,
  }

  let resultId = id
  let error
  if (id) {
    ({ error } = await supabase.from('flujos_notificacion').update(fila).eq('id', id))
  } else {
    const res = await supabase
      .from('flujos_notificacion').insert({ ...fila, creado_por: user!.id }).select('id').single()
    error = res.error
    resultId = res.data?.id ?? null
  }
  if (error) return { error: mensajeError(error, 'No se pudo guardar el flujo') }

  await logActivity(supabase, {
    accion: id ? 'UPDATE' : 'CREATE', modulo: 'Sistema',
    descripcion: `${id ? 'Actualizó' : 'Creó'} el flujo de notificación "${nombre}"`,
    entidad: 'FlujoNotificacion', entidad_id: resultId ?? undefined,
  })

  revalidatePath(RUTA)
  if (resultId) revalidatePath(`${RUTA}/${resultId}`)
  return { ok: true, id: resultId ?? undefined }
}

/** Enciende o apaga un flujo sin borrarlo. */
export async function alternarFlujo(id: string, activo: boolean): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }
  const { error } = await supabase.from('flujos_notificacion').update({ activo }).eq('id', id)
  if (error) return { error: mensajeError(error, 'No se pudo actualizar el flujo') }
  revalidatePath(RUTA); revalidatePath(`${RUTA}/${id}`)
  return { ok: true }
}

/** Elimina un flujo con sus pasos y su historial. */
export async function eliminarFlujo(id: string): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  const { data: flujo } = await supabase.from('flujos_notificacion').select('nombre').eq('id', id).maybeSingle()
  const { error } = await supabase.from('flujos_notificacion').delete().eq('id', id)
  if (error) return { error: mensajeError(error, 'No se pudo eliminar el flujo') }

  await logActivity(supabase, {
    accion: 'DELETE', modulo: 'Sistema',
    descripcion: `Eliminó el flujo de notificación "${flujo?.nombre ?? id}"`,
    entidad: 'FlujoNotificacion', entidad_id: id,
  })
  revalidatePath(RUTA)
  return { ok: true }
}

// ── Pasos ────────────────────────────────────────────────────────────────────

/** Crea o actualiza un paso del flujo. */
export async function guardarPaso(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  const id = String(formData.get('id') ?? '').trim() || null
  const flujo_id = String(formData.get('flujo_id') ?? '').trim()
  if (!flujo_id) return { error: 'Falta el flujo del paso.' }

  const tipoCrudo = String(formData.get('tipo') ?? 'EMAIL') as TipoPasoFlujo
  const tipo: TipoPasoFlujo = TIPOS.includes(tipoCrudo) ? tipoCrudo : 'EMAIL'

  const severidad = String(formData.get('severidad') ?? 'INFO')
  const demora = Number(formData.get('demora_minutos'))
  const plantillaId = String(formData.get('plantilla_id') ?? '').trim() || null
  const destinatarios = leerJson<DestinatariosPaso>(formData, 'destinatarios',
    { roles: [], usuarios: [], correos: [], campos: [] })
  const verificacion = leerJson<VerificacionPaso>(formData, 'verificacion', {})

  if (tipo === 'EMAIL' && !plantillaId && !String(formData.get('mensaje') ?? '').trim()) {
    return { error: 'Elige una plantilla o escribe el mensaje del correo.' }
  }
  if (tipo === 'EMAIL') {
    const hayDestino = (destinatarios.roles?.length ?? 0) + (destinatarios.usuarios?.length ?? 0)
      + (destinatarios.correos?.length ?? 0) + (destinatarios.campos?.length ?? 0)
    if (hayDestino === 0) return { error: 'Indica a quién se le envía el correo.' }
  }
  if (tipo === 'WEBHOOK' && !String(formData.get('webhook_url') ?? '').trim()) {
    return { error: 'Escribe la URL del webhook.' }
  }

  // Los pasos nuevos van al final salvo que el formulario mande un orden.
  let orden = Number(formData.get('orden'))
  if (!Number.isFinite(orden) || orden < 1) {
    const { data: ultimo } = await supabase
      .from('flujo_pasos').select('orden').eq('flujo_id', flujo_id)
      .order('orden', { ascending: false }).limit(1).maybeSingle()
    orden = ((ultimo?.orden as number | undefined) ?? 0) + 1
  }

  const fila = {
    flujo_id,
    orden: Math.floor(orden),
    nombre: String(formData.get('nombre') ?? '').trim() || null,
    tipo,
    demora_minutos: Number.isFinite(demora) && demora > 0 ? Math.floor(demora) : 0,
    plantilla_id: tipo === 'EMAIL' ? plantillaId : null,
    asunto: String(formData.get('asunto') ?? '').trim() || null,
    mensaje: String(formData.get('mensaje') ?? '').trim() || null,
    destinatarios,
    severidad: SEVERIDADES.includes(severidad) ? severidad : 'INFO',
    enlace: String(formData.get('enlace') ?? '').trim() || null,
    webhook_url: tipo === 'WEBHOOK' ? String(formData.get('webhook_url') ?? '').trim() || null : null,
    verificacion: verificacion.tabla && verificacion.campo ? verificacion : {},
    detener_si_falla: formData.get('detener_si_falla') === 'on',
    activo: formData.get('activo') !== 'off',
  }

  const { error } = id
    ? await supabase.from('flujo_pasos').update(fila).eq('id', id)
    : await supabase.from('flujo_pasos').insert(fila)
  if (error) return { error: mensajeError(error, 'No se pudo guardar el paso') }

  revalidatePath(`${RUTA}/${flujo_id}`)
  return { ok: true }
}

/** Elimina un paso del flujo. */
export async function eliminarPaso(id: string, flujoId: string): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }
  const { error } = await supabase.from('flujo_pasos').delete().eq('id', id)
  if (error) return { error: mensajeError(error, 'No se pudo eliminar el paso') }
  revalidatePath(`${RUTA}/${flujoId}`)
  return { ok: true }
}

/** Sube o baja un paso intercambiando su orden con el vecino. */
export async function moverPaso(id: string, flujoId: string, direccion: 'arriba' | 'abajo'): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  const { data: pasos } = await supabase
    .from('flujo_pasos').select('id, orden').eq('flujo_id', flujoId).order('orden', { ascending: true })
  const lista = (pasos ?? []) as { id: string; orden: number }[]
  const i = lista.findIndex((p) => p.id === id)
  const j = direccion === 'arriba' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= lista.length) return { ok: true }

  await supabase.from('flujo_pasos').update({ orden: lista[j].orden }).eq('id', lista[i].id)
  await supabase.from('flujo_pasos').update({ orden: lista[i].orden }).eq('id', lista[j].id)

  revalidatePath(`${RUTA}/${flujoId}`)
  return { ok: true }
}

// ── Eventos del catálogo ─────────────────────────────────────────────────────

/** Crea o actualiza un evento personalizado del catálogo. */
export async function guardarEvento(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  const id = String(formData.get('id') ?? '').trim() || null
  const nombre = String(formData.get('nombre') ?? '').trim()
  if (nombre.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres.' }

  // El código de un evento es el contrato con el código que lo emite: una vez
  // creado no se cambia, para no dejar flujos huérfanos.
  const codigo = (String(formData.get('codigo') ?? '').trim() || slug(nombre)).toUpperCase()

  const variables = String(formData.get('variables') ?? '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((linea) => {
      const [clave, ...resto] = linea.split(':')
      return { clave: clave.trim(), descripcion: resto.join(':').trim() || undefined }
    })
    .filter((v) => v.clave)

  const fila = {
    nombre,
    descripcion: String(formData.get('descripcion') ?? '').trim() || null,
    modulo: String(formData.get('modulo') ?? '').trim() || 'General',
    variables,
    payload_ejemplo: leerJson<Record<string, unknown>>(formData, 'payload_ejemplo', {}),
    activo: formData.get('activo') !== 'off',
  }

  const { error } = id
    ? await supabase.from('eventos_notificacion').update(fila).eq('id', id)
    : await supabase.from('eventos_notificacion').insert({ ...fila, codigo, es_sistema: false })
  if (error) return { error: mensajeError(error, 'No se pudo guardar el evento') }

  revalidatePath(RUTA); revalidatePath('/notificaciones/eventos')
  return { ok: true }
}

/** Elimina un evento personalizado (los del sistema no se borran). */
export async function eliminarEvento(id: string): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  const { data: evento } = await supabase
    .from('eventos_notificacion').select('codigo, nombre, es_sistema').eq('id', id).maybeSingle()
  if (!evento) return { error: 'El evento ya no existe.' }
  if (evento.es_sistema) return { error: 'Los eventos del sistema no se pueden eliminar. Puedes desactivarlos.' }

  const { count } = await supabase
    .from('flujos_notificacion').select('id', { count: 'exact', head: true }).eq('evento_codigo', evento.codigo)
  if ((count ?? 0) > 0) return { error: `El evento tiene ${count} flujo(s) asociado(s). Elimínalos primero.` }

  const { error } = await supabase.from('eventos_notificacion').delete().eq('id', id)
  if (error) return { error: mensajeError(error, 'No se pudo eliminar el evento') }

  revalidatePath('/notificaciones/eventos')
  return { ok: true }
}

/** Activa o desactiva un evento: apagado, ningún flujo suyo se dispara. */
export async function alternarEvento(id: string, activo: boolean): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }
  const { error } = await supabase.from('eventos_notificacion').update({ activo }).eq('id', id)
  if (error) return { error: mensajeError(error, 'No se pudo actualizar el evento') }
  revalidatePath('/notificaciones/eventos')
  return { ok: true }
}

// ── Pruebas y ejecución ──────────────────────────────────────────────────────

/**
 * Dispara el evento del flujo con su payload de ejemplo. Sirve para ver el
 * recorrido completo (condiciones, pasos, correos) sin esperar a que ocurra
 * en la operación real.
 */
export async function dispararPrueba(flujoId: string): Promise<ActionResult & { disparados?: number }> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  const { data: flujo } = await supabase
    .from('flujos_notificacion').select('nombre, evento_codigo').eq('id', flujoId).maybeSingle()
  if (!flujo) return { error: 'El flujo ya no existe.' }

  const { data: evento } = await supabase
    .from('eventos_notificacion').select('payload_ejemplo').eq('codigo', flujo.evento_codigo).maybeSingle()

  const { data, error } = await supabase.rpc('emitir_evento', {
    p_codigo: flujo.evento_codigo,
    p_payload: { ...(evento?.payload_ejemplo ?? {}), prueba: true },
    p_entidad: 'Prueba',
    p_entidad_id: flujoId,
  })
  if (error) return { error: 'No se pudo disparar el evento: ' + error.message }

  await logActivity(supabase, {
    accion: 'CREATE', modulo: 'Sistema',
    descripcion: `Disparó una prueba del flujo "${flujo.nombre}"`,
    entidad: 'FlujoNotificacion', entidad_id: flujoId,
  })

  revalidatePath(`${RUTA}/${flujoId}`)
  return { ok: true, disparados: (data as number) ?? 0 }
}

/** Ejecuta ahora los pasos vencidos, sin esperar al cron. */
export async function ejecutarPendientes(): Promise<ActionResult & { ejecutados?: number; omitidos?: number; correos?: number }> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  // El worker escribe notificaciones para OTROS usuarios y en el buzón de
  // salida: necesita el cliente de servicio, igual que el cron. El permiso ya
  // se validó arriba. Sin service role se intenta con la sesión (funciona para
  // administradores).
  let cliente: DB = supabase
  try {
    cliente = getAdmin()
  } catch {
    cliente = supabase
  }

  const res = await procesarFlujosPendientes(cliente, 50)
  revalidatePath(RUTA)
  return { ok: true, ejecutados: res.ejecutados, omitidos: res.omitidos, correos: res.correos }
}

/** Cancela una ejecución en curso y omite sus pasos pendientes. */
export async function cancelarEjecucion(ejecucionId: string, flujoId: string): Promise<ActionResult> {
  const { supabase, error: authError } = await auth()
  if (authError) return { error: authError }

  await supabase.from('flujo_ejecucion_pasos')
    .update({ estado: 'OMITIDO', resultado: 'Cancelado manualmente.' })
    .eq('ejecucion_id', ejecucionId).eq('estado', 'PROGRAMADO')
  const { error } = await supabase.from('flujo_ejecuciones')
    .update({ estado: 'CANCELADA' }).eq('id', ejecucionId)
  if (error) return { error: mensajeError(error, 'No se pudo cancelar') }

  revalidatePath(`${RUTA}/${flujoId}`)
  return { ok: true }
}
