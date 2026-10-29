import 'server-only'

// El mantenimiento del rastro de ubicación (F8), para el cron.
//
// Dos trabajos que la base ya sabe hacer y que hasta ahora no llamaba nadie:
// `ronda_purgar_ubicacion()` borra lo que pasó la retención del contrato, y
// `ronda_turnos_cerrar_vencidos()` cierra los turnos que pasaron su hora
// prevista. Las dos estaban escritas y probadas desde F8, pero sin cron **la
// retención de 3 meses no existía**: el rastro era perpetuo. Eso no es un
// detalle de limpieza, es la promesa que el módulo le hace a la persona que
// acepta que la sigan durante su turno.
//
// Está acá y no dentro del `route.ts` por la misma razón que `lib/crm/barrido.ts`:
// `scripts/auditar-permisos.mjs` marca cualquier `route.ts` que escriba sin
// comprobar un permiso, y un cron no tiene usuario con el que comprobarlo — se
// autentica con `CRON_SECRET`.
//
// Las dos funciones trabajan POR LOTES y devuelven cuántas filas tocaron, así
// que el barrido vuelve a llamarlas mientras el lote salga lleno. El tope de
// vueltas no es decoración: sin él, el día que alguien baje la retención de 12
// meses a 1 esta ruta se quedaría borrando hasta que Vercel la corte a los 60 s,
// y un cron que siempre muere por tiempo no se distingue de uno que está roto.
// Con tope, lo que falte se lleva a la hora siguiente, que para una purga es
// exactamente igual de bueno.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any

export interface ResultadoBarridoUbicacion {
  /** Registros de rastro borrados por haber pasado la retención del contrato. */
  purgados: number
  /** Turnos que seguían ABIERTOS pasada su hora prevista y se cerraron. */
  turnosCerrados: number
  /** `true` si el tope de vueltas cortó el trabajo antes de terminarlo. */
  quedaPendiente: boolean
}

/** Filas por llamada. El tope duro de la función en la base es 50.000. */
export const LOTE_PURGA = 5000
/** Turnos por llamada. El tope duro de la función en la base es 5.000. */
export const LOTE_TURNOS = 500
/** Vueltas máximas de cada trabajo en una corrida del cron. */
export const MAX_VUELTAS = 10

async function porLotes(supabase: Sb, fn: string, lote: number): Promise<{ total: number; corto: boolean }> {
  let total = 0
  for (let i = 0; i < MAX_VUELTAS; i++) {
    const { data, error } = await supabase.rpc(fn, { p_lote: lote })
    if (error) throw new Error(`${fn}: ${error.message}`)
    const n = Number(data ?? 0)
    total += n
    // Un lote que no sale lleno quiere decir que ya no queda nada más.
    if (n < lote) return { total, corto: false }
  }
  return { total, corto: true }
}

/**
 * Purga el rastro vencido y cierra los turnos que se pasaron de hora.
 *
 * El orden importa poco pero no es casual: primero se cierran los turnos, para
 * que un turno que acaba de vencer no siga aceptando posiciones mientras corre
 * la purga.
 */
export async function barrerUbicacion(supabase: Sb): Promise<ResultadoBarridoUbicacion> {
  const turnos = await porLotes(supabase, 'ronda_turnos_cerrar_vencidos', LOTE_TURNOS)
  const purga = await porLotes(supabase, 'ronda_purgar_ubicacion', LOTE_PURGA)
  return {
    purgados: purga.total,
    turnosCerrados: turnos.total,
    quedaPendiente: purga.corto || turnos.corto,
  }
}
