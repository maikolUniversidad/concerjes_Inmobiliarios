// Utilidades de cliente: generar la plantilla y parsear el archivo cargado.
import ExcelJS from 'exceljs'
import type { EntityConfig, FilaParseada } from './config'

const VERDE = 'FF2E7D32'

/** Genera y descarga una plantilla .xlsx con encabezados, una fila de ejemplo e instrucciones. */
export async function descargarPlantilla(config: EntityConfig) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios'

  // Hoja de datos
  const ws = wb.addWorksheet('Datos')
  ws.columns = config.columns.map(c => ({ header: c.label, key: c.key, width: Math.max(16, c.label.length + 4) }))

  // Estilo de encabezado
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.height = 22

  // Fila de ejemplo
  ws.addRow(config.columns.reduce((acc, c) => { acc[c.key] = c.ejemplo; return acc }, {} as Record<string, string | number>))
  ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } }

  // Hoja de instrucciones
  const ins = wb.addWorksheet('Instrucciones')
  ins.getColumn(1).width = 110
  ins.addRow([`PLANTILLA DE CARGA MASIVA — ${config.label.toUpperCase()}`])
  ins.getRow(1).font = { bold: true, size: 14, color: { argb: VERDE } }
  ins.addRow([])
  ins.addRow(['CÓMO USARLA:'])
  ins.getRow(3).font = { bold: true }
  config.instrucciones.forEach(t => ins.addRow(['• ' + t]))
  ins.addRow([])
  ins.addRow(['COLUMNAS:'])
  ins.getRow(ins.rowCount).font = { bold: true }
  config.columns.forEach(c => {
    const partes = [c.label, c.required ? '(obligatorio)' : '(opcional)', c.ayuda ?? '']
    if (c.enumValues) partes.push('Valores: ' + c.enumValues.join(', '))
    ins.addRow(['   - ' + partes.filter(Boolean).join(' · ')])
  })
  ins.addRow([])
  ins.addRow(['La fila 2 de la hoja "Datos" es un EJEMPLO: bórrala o reemplázala con tus datos reales.'])

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `plantilla_${config.id}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function normalizaHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

/** Parsea un archivo .xlsx o .csv a filas mapeadas por la clave de columna. */
export async function parsearArchivo(file: File, config: EntityConfig): Promise<FilaParseada[]> {
  const nombre = file.name.toLowerCase()
  if (nombre.endsWith('.csv')) return parsearCSV(await file.text(), config)
  return parsearXLSX(await file.arrayBuffer(), config)
}

async function parsearXLSX(buffer: ArrayBuffer, config: EntityConfig): Promise<FilaParseada[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return []

  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = normalizaHeader(cell.value) })

  const colKeys = new Set(config.columns.map(c => c.key))
  const filas: FilaParseada[] = []

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: FilaParseada = { _fila: rowNumber }
    let algo = false
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col]
      if (!key || !colKeys.has(key)) return
      let val: unknown = cell.value
      if (val && typeof val === 'object' && 'text' in (val as object)) val = (val as { text: string }).text
      if (val && typeof val === 'object' && 'result' in (val as object)) val = (val as { result: unknown }).result
      if (val !== null && val !== undefined && String(val).trim() !== '') algo = true
      obj[key] = val
    })
    if (algo) filas.push(obj)
  })
  return filas
}

function parsearCSV(texto: string, config: EntityConfig): FilaParseada[] {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lineas.length < 2) return []
  const headers = splitCSVLine(lineas[0]).map(normalizaHeader)
  const colKeys = new Set(config.columns.map(c => c.key))
  const filas: FilaParseada[] = []
  for (let i = 1; i < lineas.length; i++) {
    const celdas = splitCSVLine(lineas[i])
    const obj: FilaParseada = { _fila: i + 1 }
    let algo = false
    headers.forEach((h, idx) => {
      if (!colKeys.has(h)) return
      const v = celdas[idx]?.trim() ?? ''
      if (v !== '') algo = true
      obj[h] = v
    })
    if (algo) filas.push(obj)
  }
  return filas
}

function splitCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (ch === ',' && !inQ) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}
