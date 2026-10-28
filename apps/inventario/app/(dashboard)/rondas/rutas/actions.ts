'use server'

// Escrituras de las rutas de ronda y sus paradas (F8).
//
// Server action + RLS: la política ya exige `gestionar_rutas_ronda` más el
// contrato en el alcance, y los triggers de la tabla cubren la coherencia (la
// parada deriva su contrato y su sede del PUNTO, y una parada de otro contrato
// se rechaza). Lo único que se hace aquí es traducir esos errores a algo
// legible.
//
// Reordenar NO se hace con UPDATE: va por `ronda_ruta_ordenar()`, que renumera
// todas las paradas de una vez con la restricción de unicidad diferida. Hacerlo
// fila a fila choca en cuanto dos paradas se cruzan.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'

export interface ActionResult { error?: string; ok?: boolean }

const PERMISO = 'gestionar_rutas_ronda'
const RUTA = '/rondas/rutas'
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function hora(fd: FormData, campo: string): string | null {
  const s = texto(fd, campo)
  return s && /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : null
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese contrato no está en tu alcance.'
  }
  if (msg.includes('ux_ronda_paradas_punto')) {
    return 'Ese punto de control ya es una parada de esta ruta.'
  }
  if (msg.includes('ux_ronda_paradas_numero')) {
    return 'Ya hay otra parada con ese número en la ruta.'
  }
  if (msg.includes('ck_ruta_nombre')) return 'La ruta necesita un nombre.'
  return msg
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function cliente() {
  return (await createClient()) as any
}

export async function crearRuta(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const grupo = texto(fd, 'grupo_id')
  const sede = texto(fd, 'sede_id')
  const nombre = texto(fd, 'nombre')
  if (!grupo || !ES_UUID.test(grupo)) return { error: 'Falta el contrato.' }
  if (!sede || !ES_UUID.test(sede)) return { error: 'Falta la sede.' }
  if (!nombre) return { error: 'La ruta necesita un nombre.' }

  const sb = await cliente()
  const { error } = await sb.from('ronda_rutas').insert({
    grupo_id: grupo,
    sede_id: sede,
    nombre,
    fecha: texto(fd, 'fecha') ?? new Date().toISOString().slice(0, 10),
    persona_id: texto(fd, 'persona_id'),
    hora_inicio: hora(fd, 'hora_inicio'),
    observacion: texto(fd, 'observacion'),
  })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function cambiarEstadoRuta(id: string, estado: string): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(id)) return { error: 'Ruta no válida.' }
  if (!['PLANEADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'].includes(estado)) {
    return { error: 'Estado no válido.' }
  }
  const sb = await cliente()
  const parche: Record<string, unknown> = { estado }
  if (estado === 'EN_CURSO') parche.iniciado_at = new Date().toISOString()
  if (estado === 'COMPLETADA') parche.finalizado_at = new Date().toISOString()
  const { error } = await sb.from('ronda_rutas').update(parche).eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function borrarRuta(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(id)) return { error: 'Ruta no válida.' }
  const sb = await cliente()
  const { error } = await sb.from('ronda_rutas').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function agregarParada(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const ruta = texto(fd, 'ruta_id')
  const punto = texto(fd, 'punto_id')
  if (!ruta || !ES_UUID.test(ruta)) return { error: 'Ruta no válida.' }
  if (!punto || !ES_UUID.test(punto)) return { error: 'Elige un punto de control.' }

  const sb = await cliente()
  // El número de parada: el siguiente de la ruta. Se cuenta en SQL con `head`,
  // sin traerse las filas (que es la regla de la casa para no acercarse al
  // corte de 8 s de Supabase).
  const { data: ultima, error: eUlt } = await sb.from('ronda_ruta_paradas')
    .select('numero_parada').eq('ruta_id', ruta)
    .order('numero_parada', { ascending: false }).limit(1)
  if (eUlt) return { error: traducir(eUlt.message) }
  const siguiente = (ultima?.[0]?.numero_parada ?? 0) + 1
  if (siguiente > 500) return { error: 'Una ruta admite hasta 500 paradas.' }

  // `grupo_id` y `sede_id` NO se mandan: los deriva del punto el trigger
  // `ronda_paradas_derivar`, que además rechaza un punto de otro contrato.
  const { error } = await sb.from('ronda_ruta_paradas').insert({
    ruta_id: ruta,
    punto_id: punto,
    numero_parada: siguiente,
    hora_estimada: hora(fd, 'hora_estimada'),
    observacion: texto(fd, 'observacion'),
  })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function quitarParada(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(id)) return { error: 'Parada no válida.' }
  const sb = await cliente()
  const { error } = await sb.from('ronda_ruta_paradas').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}

/** Reordena TODAS las paradas de la ruta. Va por la RPC a propósito: ver la
 *  nota de arriba sobre la restricción diferida. */
export async function ordenarParadas(ruta: string, paradas: string[]): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  if (!ES_UUID.test(ruta)) return { error: 'Ruta no válida.' }
  if (paradas.length === 0 || paradas.some((p) => !ES_UUID.test(p))) {
    return { error: 'La lista de paradas no es válida.' }
  }
  const sb = await cliente()
  const { error } = await sb.rpc('ronda_ruta_ordenar', { p_ruta: ruta, p_paradas: paradas })
  if (error) return { error: traducir(error.message) }
  revalidatePath(RUTA)
  return { ok: true }
}
