// La jornada de mensajería del contrato, para PREVISUALIZAR (Ley 2191 de 2022).
//
// QUIÉN DECIDE, Y QUIÉN SOLO MUESTRA: la decisión de si un mensaje sale o se
// aplaza la toma la base de datos —`whatsapp_jornada()` y
// `crm_envio_siguiente_ventana()`, que además conocen las excepciones
// autorizadas y el estado de la persona en la nómina—. Lo de este archivo NO
// decide nada: es lo que la pantalla necesita para poder decir, antes de
// confirmar, «este envío va a quedar fuera de la jornada y saldría mañana a las
// 06:00». Si alguna vez discrepan, manda la base.
//
// Es el mismo reparto de papeles que ya usa el bot: la máquina de estados sabe
// si la jornada está abierta solo para ELEGIR QUÉ DECIR, y quien impide el envío
// es el portero.
//
// UNA FRANJA ES UN INTERVALO, NO UN PAR DE HORAS: 22:00–06:00 cruza la
// medianoche y es UNA jornada continua, no dos trozos. Y todo se mide en la hora
// de Colombia: calcularlo en UTC daría el día anterior entre las 19:00 y la
// medianoche.

export interface Franja {
  /** `HH:MM` o `HH:MM:SS`. */
  desde: string
  hasta: string
}

const ZONA = 'America/Bogota'

/** Minutos desde la medianoche de un `HH:MM[:SS]`, o `null` si no es una hora. */
export function minutosDeHora(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((hhmm ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** La hora local de Colombia de un momento, en minutos desde la medianoche. */
export function minutosLocales(momento: Date, zona = ZONA): number {
  const partes = new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zona,
  }).format(momento)
  // `Intl` devuelve «24:05» a la medianoche en algunos entornos.
  const [h, m] = partes.split(':').map((x) => Number(x))
  return ((h % 24) * 60 + m) % 1440
}

/**
 * ¿Ese momento cae dentro de la franja?
 *
 * Una franja con desde == hasta son las 24 horas: es como el contrato dice «sin
 * restricción», y es lo que hace la base.
 */
export function dentroDeFranja(momento: Date, franja: Franja, zona = ZONA): boolean {
  const desde = minutosDeHora(franja.desde)
  const hasta = minutosDeHora(franja.hasta)
  if (desde === null || hasta === null) return true
  const ahora = minutosLocales(momento, zona)
  if (desde === hasta) return true
  if (desde < hasta) return ahora >= desde && ahora < hasta
  return ahora >= desde || ahora < hasta
}

/**
 * Cuándo se abre la próxima ventana: el mismo momento si ya estamos dentro, o la
 * próxima vez que el reloj llegue a `desde`.
 *
 * Devuelve un `Date`. Para mostrarlo se usa la hora de Colombia, igual que todo
 * el módulo.
 */
export function siguienteApertura(momento: Date, franja: Franja, zona = ZONA): Date {
  if (dentroDeFranja(momento, franja, zona)) return momento
  const desde = minutosDeHora(franja.desde)
  if (desde === null) return momento
  const ahora = minutosLocales(momento, zona)
  // Minutos que faltan hasta la próxima apertura, cruzando la medianoche si hace
  // falta. Nunca 0: si estuviéramos justo en la apertura, ya estaríamos dentro.
  const faltan = ((desde - ahora) + 1440) % 1440 || 1440
  return new Date(momento.getTime() + faltan * 60_000)
}

/** La franja en palabras, para la pantalla. */
export function franjaEnPalabras(franja: Franja | null): string {
  if (!franja?.desde || !franja?.hasta) return 'sin jornada definida en el contrato'
  const corta = (h: string) => h.slice(0, 5)
  if (corta(franja.desde) === corta(franja.hasta)) return 'las 24 horas'
  return `de ${corta(franja.desde)} a ${corta(franja.hasta)}`
}
