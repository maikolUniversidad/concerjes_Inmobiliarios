// Rango de una semana ISO (YYYY-Www) para filtrar por fecha.
// Los bordes se alinean a la medianoche local de Colombia (UTC-5, sin horario
// de verano) para que "la semana" coincida con lo que ve el usuario.

const TZ_OFFSET_MS = 5 * 3600_000 // Colombia = UTC-5

/** Lunes (UTC) de una semana ISO dada. */
function lunesISO(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7 // 1..7 (lun..dom)
  const semana1Lunes = new Date(jan4)
  semana1Lunes.setUTCDate(jan4.getUTCDate() - dow + 1)
  const lunes = new Date(semana1Lunes)
  lunes.setUTCDate(semana1Lunes.getUTCDate() + (week - 1) * 7)
  return lunes
}

export interface RangoSemana { desde: string; hasta: string }

/** Convierte "2026-W32" en el rango [lunes 00:00, lunes siguiente 00:00) en hora Colombia (ISO UTC). */
export function rangoSemana(semana: string | null | undefined): RangoSemana | null {
  if (!semana) return null
  const m = String(semana).match(/^(\d{4})-W(\d{2})$/)
  if (!m) return null
  const year = Number(m[1]); const week = Number(m[2])
  if (week < 1 || week > 53) return null
  const lunesUtc = lunesISO(year, week)
  // Medianoche de Colombia = 05:00 UTC de ese día.
  const desde = new Date(lunesUtc.getTime() + TZ_OFFSET_MS)
  const hasta = new Date(desde.getTime() + 7 * 24 * 3600_000)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}
