// Los relojes de una visita (ADR-02 §2.9).
//
// La hora del celular es DATO, no verdad: se cambia en dos toques. La que manda
// es la del servidor, y la base la pone ella misma (`NOW()`), no la recibe.
// Aquí solo se calcula lo que el dispositivo puede saber y se deja claro qué
// significa cada número:
//
//   · `tDispositivo`  — `Date.now()` del celular, lo que la persona ve.
//   · `monoMs`        — reloj monotónico (`performance.now()`), que NO va para
//                       atrás sin reiniciar el equipo.
//   · desfase         — diferencia con la hora del servidor, cuando hay señal.
//                       Es señal de reloj torcido.
//   · demora de sync  — cuánto esperó una visita en la cola. NO es una señal de
//                       fraude: un sótano sin señal es el caso normal, y
//                       confundir las dos cosas haría sospechosa toda ronda
//                       nocturna de parqueadero.
//
// La cadena completa del ADR-02 (ancla firmada por el servidor, `hash_anterior`
// por dispositivo y la declaración de reinicio) es de F13: media cadena da una
// señal que no se puede verificar, y eso es peor que no tenerla.

export interface MarcaDeTiempo {
  /** ISO 8601 con zona, como lo guarda la base. */
  tDispositivo: string
  /** Monotónico en milisegundos desde que arrancó la app, si se puede leer. */
  monoMs: number | null
}

interface RelojGlobal {
  performance?: { now?: () => number }
}

/** Marca de tiempo del dispositivo para un evento de la visita. */
export function marcar(ahora: Date = new Date()): MarcaDeTiempo {
  const g = globalThis as unknown as RelojGlobal
  const mono = typeof g.performance?.now === 'function' ? Math.round(g.performance.now()) : null
  return { tDispositivo: ahora.toISOString(), monoMs: mono }
}

/** Segundos de diferencia entre el reloj del celular y el del servidor. Solo
 *  tiene sentido cuando la visita se abrió EN LÍNEA. */
export function desfaseSegundos(tDispositivo: string, tServidor: string): number {
  return Math.abs(Math.round(
    (new Date(tServidor).getTime() - new Date(tDispositivo).getTime()) / 1000))
}

/** Segundos que una visita estuvo esperando en la cola antes de llegar. */
export function demoraSincronizacionSegundos(tDispositivo: string, tLlegada: string): number {
  return Math.max(0, Math.round(
    (new Date(tLlegada).getTime() - new Date(tDispositivo).getTime()) / 1000))
}

/**
 * Qué decirle a la persona sobre la hora de una visita que se envía tarde. La
 * PWA lo muestra en la cola: lo que se conserva es la hora en que trabajó, y lo
 * que queda registrado como oficial es la del servidor. Decirlo evita la
 * sorpresa de ver una visita "de las 7 a. m." en el tablero de las 9.
 */
export function textoHoraPendiente(tDispositivo: string, enviadaEn?: string | null): string {
  const d = new Date(tDispositivo)
  const hora = d.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })
  if (!enviadaEn) {
    return `Hecha a las ${hora} en tu celular. Se envía cuando haya señal, y el sistema registra además la hora en que llegue.`
  }
  const seg = demoraSincronizacionSegundos(tDispositivo, enviadaEn)
  const min = Math.round(seg / 60)
  const espera = min < 60 ? `${min} min` : `${Math.round(min / 60)} h`
  return `Hecha a las ${hora} y enviada ${espera} después. La hora que vale para el reporte es la del servidor.`
}

/** 1 = lunes … 7 = domingo en hora de Bogotá, la misma convención de
 *  `ronda_asignaciones.dias`. El día se saca en Bogotá y no en UTC: a las 21:00
 *  de Bogotá, en UTC ya es el día siguiente. */
export function diaSemanaBogota(fecha: Date = new Date()): number {
  const texto = fecha.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const [a, m, d] = texto.split('-').map(Number)
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return dow === 0 ? 7 : dow
}
