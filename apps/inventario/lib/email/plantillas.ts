/**
 * Plantillas de correo: render de variables `{{clave}}`, extracción de las
 * variables usadas y saneado del HTML que se sube como archivo.
 *
 * Sin dependencias: se usa igual en acciones de servidor, en el worker de
 * flujos y en la previsualización del navegador.
 */

export interface PlantillaCorreo {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: string | null
  asunto: string
  cuerpo_html: string
  cuerpo_texto: string | null
  variables: VariablePlantilla[]
  origen: 'EDITOR' | 'ARCHIVO'
  archivo_nombre: string | null
  activa: boolean
  es_sistema: boolean
  creado_por: string | null
  created_at: string
  updated_at: string
}

export interface VariablePlantilla {
  clave: string
  descripcion?: string
  ejemplo?: string
}

export type Payload = Record<string, unknown>

const RE_VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g

/** Escapa el valor antes de inyectarlo en el HTML del correo. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Lee `cliente.email` dentro del payload. */
function valorPorRuta(payload: Payload, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((acc, parte) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[parte]
    return undefined
  }, payload)
}

/**
 * Reemplaza `{{clave}}` por su valor del payload. Las claves sin valor quedan
 * vacías (nunca se envía un correo con `{{algo}}` visible).
 */
export function renderTexto(plantilla: string, payload: Payload, opciones?: { escaparHtml?: boolean }): string {
  if (!plantilla) return ''
  return plantilla.replace(RE_VARIABLE, (_m, clave: string) => {
    const v = valorPorRuta(payload, clave)
    if (v === undefined || v === null) return ''
    const texto = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return opciones?.escaparHtml ? escapar(texto) : texto
  })
}

export interface CorreoRenderizado {
  asunto: string
  html: string
  texto: string
}

/** Renderiza asunto, HTML y texto plano de una plantilla con un payload. */
export function renderPlantilla(
  plantilla: Pick<PlantillaCorreo, 'asunto' | 'cuerpo_html' | 'cuerpo_texto'>,
  payload: Payload,
): CorreoRenderizado {
  const html = renderTexto(plantilla.cuerpo_html, payload, { escaparHtml: true })
  return {
    asunto: renderTexto(plantilla.asunto, payload),
    html,
    texto: plantilla.cuerpo_texto
      ? renderTexto(plantilla.cuerpo_texto, payload)
      : htmlATexto(html),
  }
}

/** Versión en texto plano razonable a partir del HTML. */
export function htmlATexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Todas las variables `{{}}` que aparecen en asunto + cuerpo, sin repetir. */
export function variablesUsadas(...textos: (string | null | undefined)[]): string[] {
  const set = new Set<string>()
  for (const t of textos) {
    if (!t) continue
    for (const m of t.matchAll(RE_VARIABLE)) set.add(m[1])
  }
  return [...set]
}

/**
 * Limpia el HTML de una plantilla subida como archivo: fuera scripts, iframes,
 * objetos y manejadores `on*`, que ningún cliente de correo ejecuta y solo
 * sirven para colar contenido indeseado. Se conservan estilos y estructura.
 */
export function sanearHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

/** Payload de muestra a partir de las variables declaradas (previsualización). */
export function payloadEjemplo(variables: VariablePlantilla[]): Payload {
  return Object.fromEntries(
    variables.map((v) => [v.clave, v.ejemplo ?? `[${v.clave}]`]),
  )
}

/** Slug estable para el código de una plantilla o un flujo. */
export function slug(texto: string): string {
  return texto
    // NFD separa la tilde de la letra; al quitar lo no-ASCII queda el slug limpio.
    .normalize('NFD').replace(/[^\x20-\x7E]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70)
}
