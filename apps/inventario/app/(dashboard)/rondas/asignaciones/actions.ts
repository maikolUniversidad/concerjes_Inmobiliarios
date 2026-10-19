'use server'

// Escrituras de las asignaciones de tareas a puntos (F3 del módulo de Puntos QR).
//
// Server action + RLS: la política ya exige `gestionar_asignaciones_rondas` más
// el contrato en el alcance, y los CHECK de la tabla cubren la coherencia
// (responsable obligatorio, `cada_horas` solo en CADA_N_HORAS, media ventana,
// días de 1 a 7). Lo único que se hace aquí es traducir esos errores a algo
// legible y resolver la persona por documento.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { FRECUENCIAS, PRIORIDADES, type FrecuenciaAsignacion, type PrioridadAsignacion } from '@/lib/ronda/pasos'

export interface ActionResult { error?: string; ok?: boolean }

const PERMISO = 'gestionar_asignaciones_rondas'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function entero(fd: FormData, campo: string): number | null {
  const s = texto(fd, campo)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}
function hora(fd: FormData, campo: string): string | null {
  const s = texto(fd, campo)
  return s && /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : null
}
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true'
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese contrato no está en tu alcance.'
  }
  if (msg.includes('ux_ronda_asignaciones_punto_plantilla')) {
    return 'Ya hay esa misma tarea asignada a ese punto en esa ventana. Cambia la hora o la frecuencia.'
  }
  if (msg.includes('ck_asignacion_responsable')) {
    return 'Hay que decir quién responde: un rol, un cargo o una persona.'
  }
  if (msg.includes('ck_asignacion_cada_horas')) {
    return 'Cada cuántas horas solo se pone (y es obligatorio) con la frecuencia «cada N horas».'
  }
  if (msg.includes('ck_asignacion_evento')) {
    return 'El evento solo se pone (y es obligatorio) con la frecuencia «cuando pasa algo».'
  }
  if (msg.includes('ck_asignacion_ventana')) {
    return 'La ventana necesita hora de inicio Y hora de fin, o ninguna de las dos.'
  }
  if (msg.includes('ck_asignacion_dias')) return 'Hay que marcar al menos un día.'
  if (msg.includes('ck_asignacion_vigencia')) {
    return 'La fecha de fin no puede ser anterior a la de inicio.'
  }
  if (msg.includes('fk_ronda_asignaciones_punto')) return 'Ese punto de control no existe.'
  return 'No se pudo guardar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

/** Crea o actualiza una asignación. */
export async function guardarAsignacion(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const grupo = texto(fd, 'grupo_id')
  const sede = texto(fd, 'sede_id')
  const punto = texto(fd, 'punto_id')
  if (!grupo) return { error: 'Hay que decir de qué contrato es.' }
  if (!sede) return { error: 'Hay que decir en qué sede está el punto.' }
  if (!punto || !ES_UUID.test(punto)) {
    return { error: 'Hay que indicar el punto de control (su identificador).' }
  }
  const plantilla = (texto(fd, 'plantilla_codigo') ?? '').toUpperCase()
  if (!plantilla) return { error: 'Hay que elegir la plantilla de tarea.' }

  const frecuencia = String(fd.get('frecuencia') ?? '') as FrecuenciaAsignacion
  if (!FRECUENCIAS.includes(frecuencia)) return { error: 'Frecuencia no válida.' }
  const prioridad = String(fd.get('prioridad') ?? 'MEDIA') as PrioridadAsignacion
  if (!PRIORIDADES.includes(prioridad)) return { error: 'Prioridad no válida.' }

  const dias = fd.getAll('dias').map((d) => Number(d)).filter((n) => n >= 1 && n <= 7)
  if (dias.length === 0) return { error: 'Hay que marcar al menos un día.' }

  const desde = hora(fd, 'ventana_desde')
  const hasta = hora(fd, 'ventana_hasta')
  if (!!desde !== !!hasta) {
    return { error: 'La ventana necesita hora de inicio Y hora de fin, o ninguna de las dos.' }
  }

  const cada = frecuencia === 'CADA_N_HORAS' ? entero(fd, 'cada_horas') : null
  if (frecuencia === 'CADA_N_HORAS' && (cada === null || cada < 1 || cada > 168)) {
    return { error: 'Cada cuántas horas va de 1 a 168.' }
  }
  const evento = frecuencia === 'POR_EVENTO' ? texto(fd, 'evento') : null
  if (frecuencia === 'POR_EVENTO' && !evento) {
    return { error: 'Con la frecuencia «cuando pasa algo» hay que decir qué la dispara.' }
  }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // La persona se da por DOCUMENTO: hay 6.564 en nómina y un desplegable con
  // todas sería inmanejable (y además mostraría nombres a quien no los necesita).
  let personaId: string | null = null
  const documento = texto(fd, 'persona_documento')
  if (documento) {
    const { data: p } = await sb.from('personas').select('id')
      .eq('documento', documento).maybeSingle()
    if (!p) return { error: `No hay ninguna persona con el documento ${documento}.` }
    personaId = p.id
  }

  const fila = {
    grupo_id: grupo,
    sede_id: sede,
    punto_id: punto,
    plantilla_codigo: plantilla,
    frecuencia,
    cada_horas: cada,
    veces_por_periodo: entero(fd, 'veces_por_periodo') ?? 1,
    dias: [...new Set(dias)].sort((a, b) => a - b),
    ventana_desde: desde,
    ventana_hasta: hasta,
    tolerancia_min: entero(fd, 'tolerancia_min') ?? 30,
    evento,
    rol_id: texto(fd, 'rol_id'),
    cargo_id: texto(fd, 'cargo_id'),
    persona_id: personaId,
    prioridad,
    sla_min: entero(fd, 'sla_min'),
    vigente_desde: texto(fd, 'vigente_desde'),
    vigente_hasta: texto(fd, 'vigente_hasta'),
    activo: marcado(fd, 'activo'),
    observacion: texto(fd, 'observacion'),
  }
  if (!fila.rol_id && !fila.cargo_id && !fila.persona_id) {
    return { error: 'Hay que decir quién responde: un rol, un cargo o una persona.' }
  }

  const id = texto(fd, 'id')
  const { error } = id
    ? await sb.from('ronda_asignaciones').update(fila).eq('id', id)
    : await sb.from('ronda_asignaciones').insert(fila)
  if (error) return { error: traducir(error.message) }

  revalidatePath('/rondas/asignaciones')
  return { ok: true }
}

/** Activa o desactiva una asignación sin borrarla. */
export async function alternarAsignacion(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb, user } = await cliente()
  if (!user) return
  const { data: fila } = await sb.from('ronda_asignaciones').select('activo').eq('id', id).maybeSingle()
  if (!fila) return
  await sb.from('ronda_asignaciones').update({ activo: !fila.activo }).eq('id', id)
  revalidatePath('/rondas/asignaciones')
}

export async function eliminarAsignacion(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb, user } = await cliente()
  if (!user) return
  await sb.from('ronda_asignaciones').delete().eq('id', id)
  revalidatePath('/rondas/asignaciones')
}
