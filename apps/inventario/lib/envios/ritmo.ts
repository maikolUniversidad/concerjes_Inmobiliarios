// El ritmo de un envío masivo: la aritmética, sin entorno y sin base de datos.
//
// POR QUÉ ESTÁ APARTE: estas cuatro cuentas las necesitan tres piezas, y las
// tres tienen que dar el MISMO número o el sistema promete algo que no cumple.
//
//   · `procesarSalida()` de F9 espera `intervaloMs` entre mensaje y mensaje: es
//     el que de verdad frena el envío.
//   · `crm_envio_aprobar()` reparte la hora de cada destino con el mismo
//     caudal, para que el buzón de salida no reciba 800 filas con la misma
//     marca de tiempo.
//   · La pantalla le dice a quien manda cuánto va a tardar ANTES de confirmar.
//     Un «enviar» que parece instantáneo y tarda un minuto es un botón que se
//     aprieta dos veces.
//
// EL TOPE NO ES NEGOCIABLE: un número en coexistencia tiene 20 mensajes por
// segundo fijos, y no se pueden subir ni pagando. Todo lo de acá se recorta a
// ese techo.

/** El techo del número en coexistencia. No es configuración: es de WhatsApp. */
export const TOPE_MPS = 20

/** Deja un caudal dentro de lo posible: entre 0 (excluido) y el tope. */
export function acotarMps(mps: number | null | undefined): number {
  const n = Number(mps)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(n, TOPE_MPS)
}

/**
 * El caudal con el que se puede trabajar: el MENOR entre lo que pide la
 * aplicación y lo que informó el número. Nunca menos de 1, porque un caudal de
 * cero detendría la cola para siempre.
 */
export function caudalEfectivo(
  pedido: number | null | undefined,
  deLaCuenta: number | null | undefined,
): number {
  const cuenta = Number(deLaCuenta) > 0 ? Math.min(Number(deLaCuenta), TOPE_MPS) : TOPE_MPS
  const nuestro = Number(pedido) > 0 ? Math.min(Number(pedido), TOPE_MPS) : cuenta
  return Math.max(Math.min(nuestro, cuenta), 1)
}

/** Milisegundos entre dos mensajes para no pasarse del caudal. */
export function intervaloMs(mps: number): number {
  return Math.ceil(1000 / Math.max(acotarMps(mps), 1))
}

/** Cuántos mensajes caben en un presupuesto de tiempo a un caudal dado. */
export function cabenEn(milisegundos: number, mps: number): number {
  return Math.max(Math.floor((milisegundos / 1000) * acotarMps(mps)), 1)
}

/**
 * Cuánto tarda en salir un envío, en SEGUNDOS.
 *
 * El primer mensaje sale de inmediato, así que lo que se espera son los
 * `n - 1` intervalos siguientes: 30 destinos a 2 por segundo son 14,5 s, no 15.
 */
export function segundosDeEnvio(destinos: number, mps: number): number {
  if (destinos <= 1) return 0
  return (destinos - 1) / Math.max(acotarMps(mps), 1)
}

/**
 * La hora que le toca al destino número `indice` (desde 0) del escalonado.
 *
 * Es la MISMA cuenta que hace `crm_envio_aprobar()` en la base
 * (`base + indice / mps` segundos). Vive acá para que la pantalla pueda
 * mostrarla y las pruebas puedan fijarla.
 */
export function horaDelDestino(base: Date | number, indice: number, mps: number): Date {
  const t = base instanceof Date ? base.getTime() : base
  return new Date(t + (Math.max(indice, 0) / Math.max(acotarMps(mps), 1)) * 1000)
}

/** Cuánto tarda un envío, dicho en palabras. */
export function duracionEnPalabras(destinos: number, mps: number): string {
  const seg = Math.ceil(segundosDeEnvio(destinos, mps))
  if (seg <= 0) return 'sale de inmediato'
  if (seg < 60) return `unos ${seg} s`
  const min = Math.floor(seg / 60)
  const resto = seg % 60
  return resto ? `unos ${min} min ${resto} s` : `unos ${min} min`
}
