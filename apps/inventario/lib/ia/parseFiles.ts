import type { Attachment } from './types'

// 3 MB: tras la inflación base64 (~33%) queda bajo el límite de body de Vercel (~4.5 MB)
const MAX_IMAGE = 3 * 1024 * 1024   // 3 MB
const MAX_DOC = 10 * 1024 * 1024    // 10 MB
const MAX_TEXT_CHARS = 12000        // tope de texto extraído por archivo

/** Tipos aceptados por el selector de archivos. */
export const ACCEPT_FILES =
  'image/*,.csv,.tsv,.txt,.md,.json,.log,.xlsx,.xls'

function nuevoId() {
  return globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function truncar(texto: string): string {
  if (texto.length <= MAX_TEXT_CHARS) return texto
  return texto.slice(0, MAX_TEXT_CHARS) + `\n\n… [archivo recortado, ${texto.length} caracteres en total]`
}

async function excelATexto(file: File): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const partes: string[] = []
  wb.eachSheet((sheet) => {
    partes.push(`# Hoja: ${sheet.name}`)
    sheet.eachRow((row) => {
      const valores = (row.values as unknown[]).slice(1).map(v => {
        if (v == null) return ''
        if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text)
        if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result)
        return String(v)
      })
      partes.push(valores.join('\t'))
    })
    partes.push('')
  })
  return partes.join('\n')
}

/** Convierte un File del navegador en un Attachment listo para enviar. */
export async function parseFile(file: File): Promise<Attachment> {
  const base = { id: nuevoId(), name: file.name, mime: file.type, size: file.size }
  const lower = file.name.toLowerCase()

  // Imágenes → data URL (visión)
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE) throw new Error(`La imagen "${file.name}" supera 3 MB.`)
    return { ...base, kind: 'image', dataUrl: await readAsDataURL(file) }
  }

  if (file.size > MAX_DOC) throw new Error(`El archivo "${file.name}" supera 10 MB.`)

  // Excel → texto tabulado
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return { ...base, kind: 'text', text: truncar(await excelATexto(file)) }
  }

  // Texto plano / CSV / JSON / MD
  const esTexto =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    /\.(csv|tsv|txt|md|json|log)$/.test(lower)
  if (esTexto) {
    return { ...base, kind: 'text', text: truncar(await file.text()) }
  }

  throw new Error(`Tipo de archivo no soportado: "${file.name}".`)
}
