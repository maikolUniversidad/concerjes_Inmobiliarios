// Metadatos de UI del proceso de selección. Las fases viven en lib/ats/fases.

export { FASES, BANDEJAS, faseMeta, esCorte, siguienteFase, semaforoDias, FLUJO } from '@/lib/ats/fases'

// Estados de un documento cargado
export const DOC_ESTADO: Record<string, { label: string; color: string }> = {
  CARGADO:       { label: 'Cargado',       color: 'bg-blue-100 text-blue-700' },
  EN_VALIDACION: { label: 'En validación', color: 'bg-indigo-100 text-indigo-700' },
  VALIDADO:      { label: 'Validado',      color: 'bg-green-100 text-green-700' },
  RECHAZADO:     { label: 'Rechazado',     color: 'bg-red-100 text-red-700' },
  VENCIDO:       { label: 'Vencido',       color: 'bg-amber-100 text-amber-700' },
  PENDIENTE:     { label: 'Pendiente',     color: 'bg-gray-100 text-gray-600' },
}

// Estados de un documento generado (formatos de contratación)
export const DOCGEN_ESTADO: Record<string, { label: string; color: string }> = {
  PENDIENTE_FIRMA: { label: 'Pendiente de firma', color: 'bg-amber-100 text-amber-800' },
  FIRMADO:         { label: 'Firmado',            color: 'bg-green-100 text-green-700' },
  GENERADO:        { label: 'Generado',           color: 'bg-blue-100 text-blue-700' },
  ANULADO:         { label: 'Anulado',            color: 'bg-gray-200 text-gray-500' },
}
