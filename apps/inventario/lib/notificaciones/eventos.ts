import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Emite un evento de negocio hacia el motor de flujos.
 *
 * El fan-out (qué flujos aplican, si sus condiciones se cumplen y qué pasos se
 * programan) lo resuelve la función SQL `emitir_evento`, que es SECURITY
 * DEFINER. Aquí solo se dispara con el payload del evento.
 *
 * El `codigo` debe existir en el catálogo `eventos_notificacion`; si no existe
 * o está desactivado, la llamada no hace nada.
 *
 * Nunca lanza: un fallo al notificar no debe romper la operación principal.
 *
 * @example
 * await emitirEvento(supabase, {
 *   codigo: 'ORDEN_INSUMO_APROBADA',
 *   payload: { orden_id: orden.id, numero: orden.numero, sede: sede.nombre },
 *   entidad: 'OrdenInsumo',
 *   entidadId: orden.id,
 * })
 */
export async function emitirEvento(
  supabase: SupabaseClient,
  params: {
    codigo: string
    payload?: Record<string, unknown>
    entidad?: string
    entidadId?: string
  },
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('emitir_evento', {
      p_codigo: params.codigo,
      p_payload: params.payload ?? {},
      p_entidad: params.entidad ?? null,
      p_entidad_id: params.entidadId ?? null,
    })
  } catch (e) {
    console.error('emitirEvento error', e)
  }
}
