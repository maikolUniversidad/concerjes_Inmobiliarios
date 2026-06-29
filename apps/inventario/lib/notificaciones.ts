import { SupabaseClient } from '@supabase/supabase-js'
import type { TipoNotificacion } from '@/lib/types/database'

/**
 * Emite una notificación evaluando la regla parametrizable `codigo`.
 *
 * El fan-out (a qué roles llega, si está activa, por qué canales y respetando
 * los silencios de cada usuario) lo resuelve la función SQL `emitir_notificacion`,
 * que es SECURITY DEFINER. Aquí solo se dispara.
 *
 * La mayoría de alertas (stock, OC, contactos, usuarios) ya se emiten solas vía
 * triggers en la base de datos. Usa este helper para alertas manuales o para
 * eventos de negocio que no tienen trigger (p. ej. un anuncio del sistema).
 *
 * Nunca lanza: un fallo al notificar no debe romper la operación principal.
 */
export async function emitirNotificacion(
  supabase: SupabaseClient,
  params: {
    codigo: TipoNotificacion
    titulo: string
    descripcion?: string
    entidad?: string
    entidadId?: string
    enlace?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('emitir_notificacion', {
      p_codigo: params.codigo,
      p_titulo: params.titulo,
      p_descripcion: params.descripcion ?? null,
      p_entidad: params.entidad ?? null,
      p_entidad_id: params.entidadId ?? null,
      p_enlace: params.enlace ?? null,
      p_metadata: params.metadata ?? {},
    })
  } catch (e) {
    console.error('emitirNotificacion error', e)
  }
}
