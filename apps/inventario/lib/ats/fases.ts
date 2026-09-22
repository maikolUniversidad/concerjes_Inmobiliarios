// Fases del proceso de selección y contratación (ATS).
//
// El proceso real de la empresa (levantado del ATS anterior) tiene 9 fases
// internas que el candidato ve agrupadas en 5. Aquí vive ese mapa, las
// bandejas del área administrativa y la regla de documentos obligatorios que
// se valida ANTES de mover a alguien de fase (con mensaje que dice qué falta).

export type EstadoCandidato =
  | 'BORRADOR' | 'POSTULADO' | 'EN_PRUEBAS' | 'EN_VERIFICACION' | 'ENTREVISTA' | 'SEGURIDAD'
  | 'EXAMEN_MEDICO' | 'APTO' | 'PRESELECCIONADO' | 'CONTRATADO' | 'ACTIVO'
  | 'NO_APTO' | 'RECHAZADO' | 'DESISTIO' | 'BANCO_TALENTO' | 'RETIRADO'

export type BandejaKey = 'POSTULACION' | 'EVALUACION' | 'SEGURIDAD' | 'EXAMENES' | 'CONTRATACION' | 'CONTRATADOS' | 'DESCARTADOS'

export interface FaseMeta {
  key: EstadoCandidato
  label: string
  descripcion: string
  bandeja: BandejaKey
  /** Fase que ve el candidato (1..5). 0 = fuera del flujo. */
  publica: number
  color: string
  corte?: boolean
}

/** Orden del flujo: APROBAR avanza a la siguiente de esta lista. */
export const FLUJO: EstadoCandidato[] = [
  'POSTULADO', 'EN_PRUEBAS', 'EN_VERIFICACION', 'ENTREVISTA', 'SEGURIDAD',
  'EXAMEN_MEDICO', 'APTO', 'PRESELECCIONADO', 'CONTRATADO', 'ACTIVO',
]

export const FASES: FaseMeta[] = [
  { key: 'POSTULADO',       label: 'Postulación',            descripcion: 'Registro enviado',                              bandeja: 'POSTULACION',  publica: 1, color: 'bg-blue-100 text-blue-700' },
  { key: 'EN_PRUEBAS',      label: 'Pruebas de selección',   descripcion: 'Presentando aptitud y conocimientos',           bandeja: 'POSTULACION',  publica: 1, color: 'bg-sky-100 text-sky-700' },
  { key: 'EN_VERIFICACION', label: 'Revisión documental',    descripcion: 'RRHH verifica documentos y antecedentes',      bandeja: 'POSTULACION',  publica: 1, color: 'bg-indigo-100 text-indigo-700' },
  { key: 'ENTREVISTA',      label: 'Psicológica / entrevista', descripcion: 'Entrevista y evaluación psicológica',        bandeja: 'EVALUACION',   publica: 2, color: 'bg-violet-100 text-violet-700' },
  { key: 'SEGURIDAD',       label: 'Seguridad AAA',          descripcion: 'Estudio de seguridad',                          bandeja: 'SEGURIDAD',    publica: 3, color: 'bg-fuchsia-100 text-fuchsia-700' },
  { key: 'EXAMEN_MEDICO',   label: 'Remitido a exámenes',    descripcion: 'Examen ocupacional de ingreso en la IPS',       bandeja: 'EXAMENES',     publica: 4, color: 'bg-cyan-100 text-cyan-700' },
  { key: 'APTO',            label: 'Apto',                   descripcion: 'Concepto médico de aptitud recibido',           bandeja: 'EXAMENES',     publica: 4, color: 'bg-teal-100 text-teal-700' },
  { key: 'PRESELECCIONADO', label: 'Seleccionado · vinculación', descripcion: 'Contrato y formatos de ingreso por firmar',  bandeja: 'CONTRATACION', publica: 5, color: 'bg-lime-100 text-lime-800' },
  { key: 'CONTRATADO',      label: 'Contratado',             descripcion: 'Firmado y entregado a nómina',                  bandeja: 'CONTRATADOS',  publica: 5, color: 'bg-green-100 text-green-700' },
  { key: 'ACTIVO',          label: 'Activo',                 descripcion: 'Trabajando',                                    bandeja: 'CONTRATADOS',  publica: 5, color: 'bg-emerald-100 text-emerald-700' },
  { key: 'NO_APTO',         label: 'No apto',                descripcion: 'No pasó exámenes médicos',                      bandeja: 'DESCARTADOS',  publica: 0, color: 'bg-red-100 text-red-700', corte: true },
  { key: 'RECHAZADO',       label: 'Descartado',             descripcion: 'No continúa en el proceso',                     bandeja: 'DESCARTADOS',  publica: 0, color: 'bg-red-100 text-red-700', corte: true },
  { key: 'DESISTIO',        label: 'Desistió',               descripcion: 'El candidato desistió',                         bandeja: 'DESCARTADOS',  publica: 0, color: 'bg-amber-100 text-amber-700', corte: true },
  { key: 'BANCO_TALENTO',   label: 'Banco de talento',       descripcion: 'Guardado para futuras vacantes',               bandeja: 'DESCARTADOS',  publica: 0, color: 'bg-orange-100 text-orange-700', corte: true },
  { key: 'RETIRADO',        label: 'Retirado',               descripcion: 'Salió de la empresa',                           bandeja: 'DESCARTADOS',  publica: 0, color: 'bg-gray-200 text-gray-600', corte: true },
]

export const BANDEJAS: { key: BandejaKey; label: string }[] = [
  { key: 'POSTULACION', label: 'Postulación' },
  { key: 'EVALUACION', label: 'Psicológica' },
  { key: 'SEGURIDAD', label: 'Seguridad AAA' },
  { key: 'EXAMENES', label: 'Exámenes' },
  { key: 'CONTRATACION', label: 'Contratación' },
  { key: 'CONTRATADOS', label: 'Contratados' },
  { key: 'DESCARTADOS', label: 'Descartados' },
]

/** Las 5 fases que ve el candidato. */
export const FASES_PUBLICAS = [
  { n: 1, label: 'Postulación', descripcion: 'Formulario, documentos y pruebas' },
  { n: 2, label: 'Evaluación psicológica y técnica', descripcion: 'Entrevista y pruebas de competencias' },
  { n: 3, label: 'Seguridad AAA', descripcion: 'Estudio interno' },
  { n: 4, label: 'Exámenes médicos', descripcion: 'Valoración de salud ocupacional' },
  { n: 5, label: 'Contratación', descripcion: 'Firma de contrato' },
]

const MAPA = new Map(FASES.map((f) => [f.key, f]))

export function faseMeta(estado: string): FaseMeta {
  return MAPA.get(estado as EstadoCandidato) ?? {
    key: estado as EstadoCandidato, label: estado, descripcion: '', bandeja: 'POSTULACION', publica: 1, color: 'bg-gray-100 text-gray-600',
  }
}

export const esCorte = (estado: string) => !!MAPA.get(estado as EstadoCandidato)?.corte

export function ordenFase(estado: string): number {
  const i = FLUJO.indexOf(estado as EstadoCandidato)
  return i < 0 ? -1 : i
}

export function siguienteFase(estado: string): EstadoCandidato | null {
  const i = ordenFase(estado)
  if (i < 0 || i >= FLUJO.length - 1) return null
  return FLUJO[i + 1]
}

/** Semáforo de días en fase: verde (≤3), ámbar (≤7), rojo (>7). */
export function semaforoDias(dias: number | null | undefined): { color: string; label: string } {
  const d = Number(dias ?? 0)
  if (d <= 3) return { color: 'bg-green-100 text-green-700', label: `${d} d` }
  if (d <= 7) return { color: 'bg-amber-100 text-amber-700', label: `${d} d` }
  return { color: 'bg-red-100 text-red-700', label: `${d} d` }
}

/** Motivo de descarte → estado de cierre. */
export function estadoPorMotivo(motivo: string): EstadoCandidato {
  if (motivo === 'DESISTIMIENTO') return 'DESISTIO'
  if (motivo === 'EXAMENES_MEDICOS' || motivo === 'TOXICOLOGIA') return 'NO_APTO'
  return 'RECHAZADO'
}

// ── Documentos obligatorios ─────────────────────────────────────────────────
export interface TipoDocRegla {
  id: string
  codigo: string
  nombre: string
  obligatorio: boolean
  min_archivos: number
  ola: number
  aplica_si: Record<string, unknown> | null
  activo?: boolean
}
export interface DocRegla { tipo_documental_id: string; estado: string }

export function tipoAplicaCargo(t: Pick<TipoDocRegla, 'aplica_si'>, flags: Record<string, unknown> | null | undefined): boolean {
  if (!t.aplica_si) return true
  return Object.entries(t.aplica_si).every(([k, esperado]) => Boolean(flags?.[k.replace(/^cargo\./, '')]) === esperado)
}

/**
 * Documentos que faltan para poder llevar a un candidato a `destino`.
 *  - Desde la entrevista en adelante: todos los obligatorios del registro (ola 1).
 *  - Para marcar APTO: además el concepto de aptitud médica.
 *  - Para contratar: además los obligatorios de vinculación (ola 2).
 * Un documento cuenta si tiene al menos `min_archivos` archivos no rechazados.
 */
export function documentosFaltantes(
  destino: string, tipos: TipoDocRegla[], docs: DocRegla[], flagsCargo: Record<string, unknown> | null | undefined,
): string[] {
  const o = ordenFase(destino)
  if (o < ordenFase('ENTREVISTA')) return []
  const cuenta = new Map<string, number>()
  for (const d of docs) {
    if (d.estado === 'RECHAZADO') continue
    cuenta.set(d.tipo_documental_id, (cuenta.get(d.tipo_documental_id) ?? 0) + 1)
  }
  const exigidos = tipos.filter((t) => {
    if (t.activo === false || !tipoAplicaCargo(t, flagsCargo)) return false
    if (t.ola === 1) return t.obligatorio
    if (t.codigo === 'CONCEPTO_APTITUD') return o >= ordenFase('APTO')
    if (t.ola === 2) return t.obligatorio && o >= ordenFase('CONTRATADO')
    return false
  })
  return exigidos
    .filter((t) => (cuenta.get(t.id) ?? 0) < Math.max(1, t.min_archivos || 1))
    .map((t) => t.nombre)
}
