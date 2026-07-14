// Estados del candidato (pipeline ATS) — metadatos de UI y transiciones.

export interface EstadoMeta { key: string; label: string; color: string; grupo: 'activo' | 'corte' }

export const ESTADOS: EstadoMeta[] = [
  { key: 'POSTULADO',       label: 'Postulado',        color: 'bg-blue-100 text-blue-700',     grupo: 'activo' },
  { key: 'EN_VERIFICACION', label: 'En verificación',  color: 'bg-indigo-100 text-indigo-700', grupo: 'activo' },
  { key: 'PRESELECCIONADO', label: 'Preseleccionado',  color: 'bg-violet-100 text-violet-700', grupo: 'activo' },
  { key: 'EXAMEN_MEDICO',   label: 'Examen médico',    color: 'bg-cyan-100 text-cyan-700',     grupo: 'activo' },
  { key: 'APTO',            label: 'Apto',             color: 'bg-teal-100 text-teal-700',     grupo: 'activo' },
  { key: 'CONTRATADO',      label: 'Contratado',       color: 'bg-green-100 text-green-700',   grupo: 'activo' },
  { key: 'ACTIVO',          label: 'Activo',           color: 'bg-emerald-100 text-emerald-700', grupo: 'activo' },
  { key: 'RETIRADO',        label: 'Retirado',         color: 'bg-gray-200 text-gray-600',     grupo: 'corte' },
  { key: 'RECHAZADO',       label: 'Rechazado',        color: 'bg-red-100 text-red-700',       grupo: 'corte' },
  { key: 'NO_APTO',         label: 'No apto',          color: 'bg-red-100 text-red-700',       grupo: 'corte' },
  { key: 'DESISTIO',        label: 'Desistió',         color: 'bg-amber-100 text-amber-700',   grupo: 'corte' },
  { key: 'BANCO_TALENTO',   label: 'Banco de talento', color: 'bg-orange-100 text-orange-700', grupo: 'corte' },
]

export const estadoMeta = (key: string): EstadoMeta =>
  ESTADOS.find((e) => e.key === key) ?? { key, label: key, color: 'bg-gray-100 text-gray-600', grupo: 'activo' }

// Estados de documento
export const DOC_ESTADO: Record<string, { label: string; color: string }> = {
  CARGADO:       { label: 'Cargado',       color: 'bg-blue-100 text-blue-700' },
  EN_VALIDACION: { label: 'En validación', color: 'bg-indigo-100 text-indigo-700' },
  VALIDADO:      { label: 'Validado',      color: 'bg-green-100 text-green-700' },
  RECHAZADO:     { label: 'Rechazado',     color: 'bg-red-100 text-red-700' },
  VENCIDO:       { label: 'Vencido',       color: 'bg-amber-100 text-amber-700' },
  PENDIENTE:     { label: 'Pendiente',     color: 'bg-gray-100 text-gray-600' },
}
