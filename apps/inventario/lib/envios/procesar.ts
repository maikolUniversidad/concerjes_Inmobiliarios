import 'server-only'

// El trabajador del envío masivo (Puntos QR F10).
//
// Es el mismo molde de `procesarCorreoSaliente` + `/api/cron/correo` que ya
// funciona en el repositorio: un lote, un presupuesto de tiempo, y lo que no
// alcanza queda en la cola con su hora. Lo que cambia respecto al correo:
//
//   · NO MANDA NADA. Encola un mensaje POR PERSONA con `whatsapp_encolar()`, y
//     el que envía de verdad es el cron de salida de F9, con su control de
//     caudal. Acá no hay un segundo control de ritmo: el reparto de horas lo
//     hizo `crm_envio_aprobar()` con el mismo número de mensajes por segundo
//     (ver lib/whatsapp/caudal.ts), y el freno real es el de F9.
//   · LA JORNADA. Fuera de la jornada del contrato, lo que no es emergencia se
//     APLAZA a la siguiente ventana en vez de nacer omitido. Eso lo decide
//     `crm_envio_tomar_lote()` en la base, donde vive la regla, y el portero lo
//     vuelve a mirar al enviar, como exige la §4.4 del complemento 2.
//
// TAMAÑO DEL LOTE: se piden como máximo los mensajes que el número podría
// mandar en el tiempo que falta hasta la próxima vuelta del cron. Encolar mucho
// más no haría que saliera antes —la cola de salida va al caudal del número— y
// sí haría más larga esta transacción.

import { cabenEn, caudalConfigurado } from '../whatsapp/caudal'
import { config } from '../whatsapp/config'

export interface ResultadoEnvios {
  /** Mensajes encolados en el buzón de salida de F9. */
  encolados: number
  /** Destinos que cayeron fuera de la jornada y esperan la siguiente ventana. */
  aplazados: number
  /** Destinos que el portero frenó (sin ventana de 24 h, plantilla sin aprobar…). */
  omitidos: number
  fallidos: number
  /** Envíos distintos tocados en esta vuelta. */
  envios: number
}

/**
 * Encola los destinos cuya hora ya venció.
 *
 * `supabase` tiene que ser el cliente de SERVICIO: `crm_envio_tomar_lote` es
 * SECURITY DEFINER y no se concede a `authenticated`, igual que las funciones de
 * la cola de F9.
 */
export async function procesarEnviosMasivos(
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  supabase: any,
  opciones: { ventanaSegundos?: number; limite?: number } = {},
): Promise<ResultadoEnvios> {
  const c = config()
  const mps = caudalConfigurado()
  // El cron corre cada minuto; se encola lo que cabría mandar en ese minuto.
  const ventanaMs = Math.max(opciones.ventanaSegundos ?? 60, 1) * 1000
  const limite = Math.min(opciones.limite ?? cabenEn(ventanaMs, mps), 2000)

  const { data, error } = await supabase.rpc('crm_envio_tomar_lote', {
    p_limite: limite,
    p_jornada_desde: c.jornadaDesde,
    p_jornada_hasta: c.jornadaHasta,
    p_margen_horas: c.ventanaSeguridadHoras,
    p_zona: c.zonaHoraria,
  })
  if (error) throw new Error(`No se pudo tomar el lote del envío masivo: ${error.message}`)

  const r = (data ?? {}) as Record<string, unknown>
  return {
    encolados: Number(r.encolados ?? 0),
    aplazados: Number(r.aplazados ?? 0),
    omitidos: Number(r.omitidos ?? 0),
    fallidos: Number(r.fallidos ?? 0),
    envios: Number(r.envios ?? 0),
  }
}
