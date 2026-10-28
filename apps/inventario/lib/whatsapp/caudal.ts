import 'server-only'

// EL CAUDAL DEL NÚMERO, EN UN SOLO SITIO.
//
// El número en coexistencia tiene un tope FIJO de 20 mensajes por segundo que
// no se puede subir: «numbers used with both the WhatsApp Business app and
// Cloud API have a fixed throughput of 20 mps». Se trabaja por debajo para
// dejar margen.
//
// POR QUÉ ESTE ARCHIVO EXISTE: dos piezas necesitan el mismo número y no pueden
// tener cada una el suyo.
//
//   · `procesarSalida()` (F9) lo usa para ESPERAR entre mensaje y mensaje: es
//     el que de verdad frena el envío.
//   · El envío masivo (F10) lo usa para REPARTIR la hora de cada destino antes
//     de encolarlos (`crm_envio_aprobar`), para que el buzón de salida no
//     reciba 800 filas con la misma marca de tiempo y la prioridad siga
//     significando algo.
//
// Si cada una calculara el suyo, un día quedarían desalineadas y el reparto
// prometería un ritmo que el envío no puede sostener. F10 NO escribe un segundo
// control de ritmo: usa este número y deja que frene el de F9.

import { config } from './config'
import { caudalEfectivo, cabenEn as cabenEnPuro, intervaloMs as intervaloMsPuro, TOPE_MPS } from '../envios/ritmo'

export { TOPE_MPS }

/** El tope propio de la aplicación (`WHATSAPP_THROUGHPUT_MPS`, 15 por defecto),
 *  nunca por encima de los 20 del número. */
export function caudalConfigurado(): number {
  return config().throughputMps
}

/**
 * Mensajes por segundo con los que se puede trabajar en una cuenta: el MENOR
 * entre el tope propio y el que informó Meta para ese número. Nunca menos de 1,
 * porque un caudal de cero detendría la cola para siempre.
 */
export function caudalDe(cuentaThroughputMps: number | null | undefined): number {
  return caudalEfectivo(caudalConfigurado(), cuentaThroughputMps)
}

/** Milisegundos que hay que dejar pasar entre dos mensajes para no pasarse del
 *  caudal. Es lo que espera `procesarSalida()` y el paso con el que
 *  `crm_envio_aprobar()` separa a los destinos. */
export function intervaloMs(mps: number): number {
  return intervaloMsPuro(mps)
}

/**
 * Cuántos mensajes caben en un presupuesto de tiempo a un caudal dado.
 *
 * Se usa para no reclamar más filas de las que se van a poder mandar: pedir 500
 * para mandar 40 dejaría 460 EN_PROCESO esperando el rescate de huérfanos.
 */
export function cabenEn(milisegundos: number, mps: number): number {
  return cabenEnPuro(milisegundos, mps)
}
