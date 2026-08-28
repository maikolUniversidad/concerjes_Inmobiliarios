// Utilidades de cliente: generar la plantilla y parsear el archivo cargado.
import ExcelJS from 'exceljs'
import type { EntityConfig, FilaParseada, ColumnDef } from './config'
import { mapearEncabezados, parsearCSV, type ArchivoParseado } from './csv'

export type { ArchivoParseado } from './csv'

const VERDE = 'FF2E7D32'
const GRIS_SUAVE = 'FFF3F4F6'

/** ExcelJS expone `dataValidations` en tiempo de ejecución pero no en sus tipos. */
type ConValidaciones = ExcelJS.Worksheet & {
  dataValidations: { add(rango: string, validacion: ExcelJS.DataValidation): void }
}

/** Formato de celda por tipo de columna, para que Excel no reinterprete los datos. */
function formatoDe(col: ColumnDef): string | undefined {
  if (col.type === 'fecha') return 'yyyy-mm-dd'
  if (col.type !== 'number') return undefined
  // Los precios se ven con separador de miles; los códigos, sin él.
  return col.key.startsWith('precio') ? '#,##0' : '0'
}

/** Genera y descarga la plantilla .xlsx de una entidad. */
export async function descargarPlantilla(config: EntityConfig) {
  const buf = await construirPlantilla(config)
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  descargar(blob, `plantilla_${config.id}.xlsx`)
}

/** Arma el libro de la plantilla: encabezados, fila de ejemplo, validaciones e instrucciones. */
export async function construirPlantilla(config: EntityConfig): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios'

  // Hoja de datos
  const ws = wb.addWorksheet('Datos')
  ws.columns = config.columns.map(c => ({
    header: c.label,
    key: c.key,
    width: Math.max(16, c.label.length + 4),
    style: formatoDe(c) ? { numFmt: formatoDe(c) } : undefined,
  }))

  // Estilo de encabezado
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.height = 22
  ws.views = [{ state: 'frozen', ySplit: 1 }]        // el encabezado queda fijo al desplazarse
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: config.columns.length } }

  // Fila de ejemplo (se detecta y se omite si no la borran).
  ws.addRow(config.columns.reduce((acc, c) => { acc[c.key] = c.ejemplo; return acc }, {} as Record<string, string | number>))
  const ejemplo = ws.getRow(2)
  ejemplo.font = { italic: true, color: { argb: 'FF888888' } }
  ejemplo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_SUAVE } }

  // Listas desplegables y validación, para que el archivo salga bien desde el origen.
  // `dataValidations` existe en ExcelJS pero no está en sus tipos.
  const val = (ws as unknown as ConValidaciones).dataValidations
  config.columns.forEach((c, i) => {
    const letra = ws.getColumn(i + 1).letter
    const rango = `${letra}2:${letra}1000`
    if (c.type === 'enum' && c.enumValues) {
      val.add(rango, {
        type: 'list', allowBlank: !c.required,
        formulae: [`"${c.enumValues.join(',')}"`],
        showErrorMessage: true,
        errorTitle: c.label,
        error: `Elige uno de: ${c.enumValues.join(', ')}`,
      })
    } else if (c.type === 'booleano') {
      val.add(rango, {
        type: 'list', allowBlank: true, formulae: ['"SI,NO"'],
        showErrorMessage: true, errorTitle: c.label, error: 'Escribe SI o NO',
      })
    } else if (c.type === 'number') {
      val.add(rango, {
        type: 'decimal', allowBlank: !c.required, operator: 'greaterThanOrEqual',
        formulae: [c.min ?? 0],
        showErrorMessage: true, errorTitle: c.label,
        error: `Debe ser un número${c.min !== undefined ? ` mayor o igual que ${c.min}` : ''}, sin símbolo de moneda.`,
      })
    }
  })

  // Hoja de instrucciones
  const ins = wb.addWorksheet('Instrucciones')
  ins.getColumn(1).width = 110
  ins.addRow([`PLANTILLA DE CARGA MASIVA — ${config.label.toUpperCase()}`])
  ins.getRow(1).font = { bold: true, size: 14, color: { argb: VERDE } }
  ins.addRow([])
  ins.addRow(['CÓMO USARLA:'])
  ins.getRow(3).font = { bold: true }
  config.instrucciones.forEach(t => ins.addRow(['• ' + t]))
  ins.addRow(['• Las columnas que dejes VACÍAS no se tocan: al actualizar se conserva lo que ya está guardado.'])
  ins.addRow(['• Si repites una misma clave en dos filas, solo se carga la primera.'])
  ins.addRow(['• Puedes borrar las columnas que no vayas a usar (menos las obligatorias) y cambiarles el orden.'])
  ins.addRow([])
  ins.addRow(['COLUMNAS:'])
  ins.getRow(ins.rowCount).font = { bold: true }
  config.columns.forEach(c => {
    const partes = [c.label, c.required ? '(obligatorio)' : '(opcional)', TIPO_LEGIBLE[c.type], c.ayuda ?? '']
    if (c.enumValues) partes.push('Valores: ' + c.enumValues.join(', '))
    if (c.alias?.length) partes.push('También se acepta: ' + c.alias.join(', '))
    ins.addRow(['   - ' + partes.filter(Boolean).join(' · ')])
  })
  ins.addRow([])
  ins.addRow(['La fila 2 de la hoja "Datos" es un EJEMPLO: bórrala o reemplázala con tus datos reales.'])
  ins.addRow(['Si la dejas, el sistema la detecta y la omite.'])

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

const TIPO_LEGIBLE: Record<ColumnDef['type'], string> = {
  text: 'texto',
  number: 'número',
  enum: 'lista',
  email: 'correo',
  fecha: 'fecha (AAAA-MM-DD o DD/MM/AAAA)',
  booleano: 'SI / NO',
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

/** Parsea un archivo .xlsx o .csv a filas mapeadas por la clave de columna. */
export async function parsearArchivo(file: File, config: EntityConfig): Promise<ArchivoParseado> {
  const nombre = file.name.toLowerCase()
  if (nombre.endsWith('.csv') || nombre.endsWith('.txt')) return parsearCSV(await file.text(), config)
  return parsearXLSX(await file.arrayBuffer(), config)
}

/** Convierte el valor crudo de una celda de ExcelJS a algo que sepamos leer. */
function valorCelda(valor: ExcelJS.CellValue): unknown {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return valor
  if (typeof valor === 'object') {
    const v = valor as unknown as Record<string, unknown>
    if ('text' in v) return v.text                                  // hipervínculo
    if ('result' in v) return v.result                              // fórmula
    if ('richText' in v) return (v.richText as { text: string }[]).map(r => r.text).join('')
    if ('error' in v) return null                                   // #N/A, #REF!, …
  }
  return valor
}

async function parsearXLSX(buffer: ArrayBuffer, config: EntityConfig): Promise<ArchivoParseado> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  // Si el archivo trae la hoja "Datos" de la plantilla, se usa esa.
  const ws = wb.getWorksheet('Datos') ?? wb.worksheets[0]
  if (!ws) return { filas: [], reconocidas: [], desconocidas: [], faltantes: [] }

  const encabezados: unknown[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    encabezados[col - 1] = valorCelda(cell.value)
  })
  const mapa = mapearEncabezados(config, encabezados)

  const filas: FilaParseada[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: FilaParseada = { _fila: rowNumber }
    let algo = false
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = mapa.porIndice[col - 1]
      if (!key) return
      const val = valorCelda(cell.value)
      if (val !== null && val !== undefined && String(val).trim() !== '') algo = true
      obj[key] = val
    })
    if (algo) filas.push(obj)
  })

  return { filas, reconocidas: mapa.reconocidas, desconocidas: mapa.desconocidas, faltantes: mapa.faltantes }
}

// ─── Informe del resultado de la carga ───────────────────────────────────────

export interface FilaInforme {
  fila: number
  clave: string
  accion: string
  error?: string
}

/** Descarga el resultado de una carga (qué se creó, qué se actualizó y qué falló). */
export async function descargarInformeCarga(
  config: EntityConfig, archivo: string, filas: FilaInforme[],
) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios'
  const ws = wb.addWorksheet('Resultado')
  ws.columns = [
    { header: 'Fila del archivo', key: 'fila', width: 16 },
    { header: 'Clave', key: 'clave', width: 38 },
    { header: 'Resultado', key: 'accion', width: 16 },
    { header: 'Detalle', key: 'error', width: 70 },
  ]
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  for (const f of filas) {
    const row = ws.addRow({ fila: f.fila, clave: f.clave, accion: f.accion, error: f.error ?? '' })
    if (f.accion === 'error') {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    }
  }

  ws.addRow([])
  ws.addRow([`Carga de ${config.label} · archivo: ${archivo}`])
  ws.addRow([`Generado: ${new Date().toLocaleString('es-CO')}`])

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  descargar(blob, `resultado_${config.id}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
