// Listas de opciones del proceso de selección: lo que antes se escribía a mano
// en la entrevista y en el formulario (con quién vive, trayectoria laboral).
// Con opciones los datos salen parejos y se pueden filtrar y comparar.

/** Parentesco de las personas con quien vive el candidato. */
export const PARENTESCOS_CONVIVENCIA = [
  'Cónyuge o compañero(a)', 'Hijo(a)', 'Hijastro(a)', 'Madre', 'Padre', 'Padrastro / madrastra', 'Hermano(a)',
  'Abuelo(a)', 'Nieto(a)', 'Tío(a)', 'Sobrino(a)', 'Primo(a)', 'Suegro(a)', 'Cuñado(a)', 'Amigo(a)', 'Arrendador(a)',
]

/** Nivel académico de las personas con quien vive. */
export const NIVELES_ACADEMICOS = [
  'Ninguno', 'Preescolar', 'Primaria en curso', 'Primaria', 'Bachillerato en curso', 'Bachiller', 'Técnico', 'Tecnólogo',
  'Universitario en curso', 'Profesional', 'Posgrado', 'No aplica (menor de edad)',
]

/** Ocupación de las personas con quien vive. */
export const OCUPACIONES = [
  'Estudiante', 'Empleado(a)', 'Independiente', 'Hogar', 'Pensionado(a)', 'Desempleado(a)', 'Menor de edad (no estudia)',
  'En situación de discapacidad',
]

/** Motivo de retiro de un empleo anterior (formulario y entrevista). */
export const MOTIVOS_RETIRO = [
  'Renuncia voluntaria', 'Terminación de la obra o labor', 'Terminación del contrato a término fijo',
  'Terminación por mutuo acuerdo', 'Despido sin justa causa', 'Despido con justa causa', 'Cierre o liquidación de la empresa',
  'No superó el periodo de prueba', 'Pensión', 'Sigue trabajando allí',
]

/** Tiempo laborado en un empleo anterior, por rangos. */
export const TIEMPOS_LABORADOS = [
  'Menos de 3 meses', 'De 3 a 6 meses', 'De 6 meses a 1 año', 'De 1 a 2 años', 'De 2 a 5 años', 'Más de 5 años',
]

/** Meses completos entre dos fechas ISO (null si falta alguna o no tiene sentido). */
export function mesesEntre(desde?: string | null, hasta?: string | null): number | null {
  if (!desde) return null
  const a = new Date(`${desde.slice(0, 10)}T12:00:00`)
  const b = hasta ? new Date(`${hasta.slice(0, 10)}T12:00:00`) : new Date()
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) meses--
  return Math.max(0, meses)
}

/** Rango de TIEMPOS_LABORADOS que corresponde a unas fechas de ingreso y retiro. */
export function rangoTiempo(desde?: string | null, hasta?: string | null): string {
  const m = mesesEntre(desde, hasta)
  if (m === null) return ''
  if (m < 3) return TIEMPOS_LABORADOS[0]
  if (m < 6) return TIEMPOS_LABORADOS[1]
  if (m < 12) return TIEMPOS_LABORADOS[2]
  if (m < 24) return TIEMPOS_LABORADOS[3]
  if (m < 60) return TIEMPOS_LABORADOS[4]
  return TIEMPOS_LABORADOS[5]
}
