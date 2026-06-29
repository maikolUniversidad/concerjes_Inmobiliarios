// Tipos compartidos del módulo Asistente IA

/** Modelos de chat disponibles. */
export type ModeloIA = 'deepseek-chat' | 'openai'

export interface ModeloInfo {
  id: ModeloIA
  label: string
  descripcion: string
}

export const MODELOS: ModeloInfo[] = [
  { id: 'deepseek-chat', label: 'DeepSeek V3', descripcion: 'Rápido y económico · por defecto' },
  { id: 'openai',        label: 'GPT-4o mini', descripcion: 'OpenAI · razonamiento alterno' },
]

export function nombreModelo(id: string): string {
  return MODELOS.find(m => m.id === id)?.label ?? id
}

// ── Especificación de gráficas ───────────────────────────────────────────────
// El modelo puede incrustar una gráfica como bloque ```chart con este JSON.
export type ChartType = 'bar' | 'line' | 'area' | 'pie'

export interface ChartSeries {
  key: string
  name?: string
  color?: string
}

export interface ChartSpec {
  type: ChartType
  title?: string
  /** Filas de datos. Cada objeto es un punto/categoría. */
  data: Record<string, string | number>[]
  /** Clave del eje X (bar/line/area). */
  xKey?: string
  /** Series a graficar (bar/line/area). */
  series?: ChartSeries[]
  /** Para pie: clave de la etiqueta y del valor. */
  nameKey?: string
  valueKey?: string
  /** Unidad opcional para tooltips (ej. "COP", "uds"). */
  unidad?: string
}

// ── Archivos adjuntos ────────────────────────────────────────────────────────
export type AttachmentKind = 'image' | 'text'

export interface Attachment {
  id: string
  name: string
  mime: string
  kind: AttachmentKind
  size: number
  /** Data URL base64 (solo imágenes) — se envía al modelo de visión. */
  dataUrl?: string
  /** Texto extraído (CSV / Excel / texto plano). */
  text?: string
}

/** Versión ligera para guardar en el historial (sin base64 ni texto pesado). */
export interface AttachmentMeta {
  name: string
  mime: string
  kind: AttachmentKind
}

/** Valida de forma laxa que un objeto parseado sea un ChartSpec usable. */
export function isChartSpec(x: unknown): x is ChartSpec {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.type === 'string' &&
    ['bar', 'line', 'area', 'pie'].includes(o.type) &&
    Array.isArray(o.data)
  )
}
