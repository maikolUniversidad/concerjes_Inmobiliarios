// Catálogos y utilidades del módulo de Mantenimiento de Maquinaria.
// Se usan tanto en la vista de campo (/equipo) como en el tablero (/mantenimiento).
// Las transiciones y reglas viven en la BD (RPC `mant_*`); aquí solo está lo visual.

export const BUCKET_MANT = 'mantenimiento'

export const ESTADO_TICKET_META: Record<string, { label: string; cls: string; dot: string }> = {
  ABIERTO:    { label: 'Abierto',     cls: 'bg-red-100 text-red-700',       dot: 'bg-red-500' },
  RECIBIDO:   { label: 'Recibido',    cls: 'bg-sky-100 text-sky-700',       dot: 'bg-sky-500' },
  EN_PROCESO: { label: 'En proceso',  cls: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
  EN_ESPERA:  { label: 'En espera',   cls: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  RESUELTO:   { label: 'Resuelto',    cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  CERRADO:    { label: 'Cerrado',     cls: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400' },
  CANCELADO:  { label: 'Cancelado',   cls: 'bg-gray-100 text-gray-400 line-through', dot: 'bg-gray-300' },
}
export const ESTADOS_TICKET_ACTIVOS = ['ABIERTO', 'RECIBIDO', 'EN_PROCESO', 'EN_ESPERA', 'RESUELTO'] as const

export const PRIORIDAD_META: Record<string, { label: string; cls: string; orden: number }> = {
  CRITICA: { label: 'Crítica', cls: 'bg-red-600 text-white',      orden: 0 },
  ALTA:    { label: 'Alta',    cls: 'bg-orange-100 text-orange-700', orden: 1 },
  MEDIA:   { label: 'Media',   cls: 'bg-yellow-100 text-yellow-700', orden: 2 },
  BAJA:    { label: 'Baja',    cls: 'bg-gray-100 text-gray-600',     orden: 3 },
}
export const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const

export const TIPO_TICKET_META: Record<string, { label: string; desc: string }> = {
  CORRECTIVO:     { label: 'Falla / daño',     desc: 'El equipo presenta una falla' },
  SOPORTE_REMOTO: { label: 'Soporte remoto',   desc: 'Necesito orientación por chat' },
  PREVENTIVO:     { label: 'Preventivo',       desc: 'Mantenimiento programado' },
  INSPECCION:     { label: 'Inspección',       desc: 'Revisión técnica programada' },
}

export const CONDICION_META: Record<string, { label: string; cls: string }> = {
  BUENA:   { label: 'Buena',   cls: 'bg-green-100 text-green-700' },
  REGULAR: { label: 'Regular', cls: 'bg-yellow-100 text-yellow-700' },
  MALA:    { label: 'Mala',    cls: 'bg-red-100 text-red-700' },
}

export const TIPO_ACTIVIDAD_META: Record<string, { label: string }> = {
  INSPECCION:  { label: 'Inspección' },
  USO:         { label: 'Uso del equipo' },
  LIMPIEZA:    { label: 'Limpieza' },
  LUBRICACION: { label: 'Lubricación' },
  REVISION:    { label: 'Revisión técnica' },
  REPARACION:  { label: 'Reparación' },
  PRUEBA:      { label: 'Prueba de funcionamiento' },
  OTRO:        { label: 'Otra' },
}
/** Actividades que puede registrar el personal de sede (el resto son de técnico). */
export const ACTIVIDADES_SEDE = ['INSPECCION', 'USO', 'LIMPIEZA', 'PRUEBA', 'OTRO'] as const
export const ACTIVIDADES_TECNICO = ['REVISION', 'LUBRICACION', 'REPARACION', 'PRUEBA', 'LIMPIEZA', 'INSPECCION', 'OTRO'] as const

/** Checklist base de la inspección de un equipo. */
export const CHECKLIST_INSPECCION = [
  'Enciende y funciona normalmente',
  'Cable y enchufe sin daños',
  'Sin ruidos ni olores extraños',
  'Carcasa y accesorios completos',
  'Limpio y guardado correctamente',
]

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

export function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const MAX_ADJUNTO_BYTES = 25 * 1024 * 1024

/**
 * Sube un archivo al bucket privado `mantenimiento` bajo la carpeta del equipo.
 * Devuelve la RUTA (no URL): para mostrarlo se firma con `firmarRutas`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function subirArchivoMant(sb: any, maquinariaId: string, carpeta: string, file: File): Promise<string> {
  if (file.size > MAX_ADJUNTO_BYTES) throw new Error(`"${file.name}" supera 25 MB.`)
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
  const path = `${maquinariaId}/${carpeta}/${id}.${ext}`
  const { error } = await sb.storage.from(BUCKET_MANT).upload(path, file, {
    upsert: false, contentType: file.type || 'application/octet-stream',
  })
  if (error) throw new Error(error.message)
  return path
}

/** Firma varias rutas del bucket de una vez. Devuelve { ruta: url }. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function firmarRutas(sb: any, rutas: string[], segundos = 3600): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))]
  if (unicas.length === 0) return {}
  const { data } = await sb.storage.from(BUCKET_MANT).createSignedUrls(unicas, segundos)
  const out: Record<string, string> = {}
  for (const d of (data ?? []) as { path: string | null; signedUrl: string }[]) {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  }
  return out
}

/** Lo que devuelve un QR o lo que alguien digita → referencia del equipo. */
export function extraerReferenciaEquipo(valor: string): string {
  const v = valor.trim()
  try {
    const u = new URL(v)
    const partes = u.pathname.split('/').filter(Boolean)
    const i = partes.findIndex((p) => p === 'equipo' || p === 'maquinaria')
    if (i >= 0 && partes[i + 1]) return decodeURIComponent(partes[i + 1])
  } catch { /* no es URL: es el código escrito */ }
  return v
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
