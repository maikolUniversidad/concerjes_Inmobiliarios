import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import type { BloqueCopiado } from './tipos'

/** Excel separa columnas por tabulador y filas por salto de línea. */
function celdaPlana(valor: string): string {
  return valor.replace(/[\t\r\n]+/g, ' ').trim()
}

export function aTSV(bloque: BloqueCopiado): string {
  const filas = bloque.encabezados.length
    ? [bloque.encabezados, ...bloque.filas]
    : bloque.filas
  return filas.map((f) => f.map(celdaPlana).join('\t')).join('\r\n')
}

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Excel respeta el HTML del portapapeles: así el pegado conserva encabezados en
 * negrita y no rompe los valores con comas o acentos.
 */
export function aHTML(bloque: BloqueCopiado): string {
  const thead = bloque.encabezados.length
    ? `<thead><tr>${bloque.encabezados
        .map((h) => `<th>${escaparHtml(celdaPlana(h))}</th>`)
        .join('')}</tr></thead>`
    : ''
  const tbody = `<tbody>${bloque.filas
    .map(
      (fila) =>
        `<tr>${fila.map((c) => `<td>${escaparHtml(celdaPlana(c))}</td>`).join('')}</tr>`
    )
    .join('')}</tbody>`
  return `<table border="1">${thead}${tbody}</table>`
}

/** Copia respaldada por textarea para navegadores sin API asíncrona. */
function copiarLegado(texto: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = texto
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export async function copiarBloque(bloque: BloqueCopiado): Promise<boolean> {
  const tsv = aTSV(bloque)
  if (!tsv) return false
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([aHTML(bloque)], { type: 'text/html' }),
        }),
      ])
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tsv)
      return true
    }
  } catch {
    /* cae al método legado */
  }
  return copiarLegado(tsv)
}

export interface DatosCopia {
  modulo: string
  entidad?: string
  titulo: string
  filas: number
  columnas: string[]
  origen: 'seleccion' | 'todo' | 'descarga'
}

/** Evita duplicar el log cuando alguien repite Ctrl+C sobre lo mismo. */
let ultimaFirma = ''
let ultimoInstante = 0

/**
 * Deja rastro en `actividad_log` de lo que se copió o descargó: quién, de qué
 * tabla, cuántas filas y qué columnas. Nunca guarda el contenido copiado.
 */
export async function registrarCopia(datos: DatosCopia): Promise<void> {
  const firma = `${datos.titulo}|${datos.origen}|${datos.filas}|${datos.columnas.join(',')}`
  const ahora = Date.now()
  if (firma === ultimaFirma && ahora - ultimoInstante < 4000) return
  ultimaFirma = firma
  ultimoInstante = ahora

  const verbo =
    datos.origen === 'descarga'
      ? 'Descargó'
      : datos.origen === 'todo'
        ? 'Copió la tabla completa'
        : 'Copió una selección'
  const descripcion =
    `${verbo} de ${datos.titulo}: ${datos.filas} fila(s) × ${datos.columnas.length} columna(s)`

  await logActivity(createClient(), {
    accion: datos.origen === 'descarga' ? 'DESCARGAR' : 'COPIAR',
    modulo: datos.modulo,
    descripcion,
    entidad: datos.entidad,
    detalle: {
      tabla: datos.titulo,
      origen: datos.origen,
      filas: datos.filas,
      columnas: datos.columnas,
    },
  })
}

/**
 * Los números entran como número para que Excel los sume; el resto va como
 * texto. Solo se convierte lo que vuelve idéntico al escribirlo de nuevo, así
 * un código como `007` o un `1/1` conservan su forma.
 */
function valorExcel(valor: string): string | number {
  const texto = celdaPlana(valor)
  if (texto === '') return ''
  const numero = Number(texto)
  return Number.isFinite(numero) && String(numero) === texto ? numero : texto
}

/**
 * Descarga la tabla como un .xlsx de verdad: encabezado con el verde de la
 * marca, fila congelada, autofiltro y anchos según el contenido. `exceljs` se
 * carga bajo demanda para no engordar la pantalla mientras nadie descarga.
 */
export async function descargarExcel(
  bloque: BloqueCopiado,
  nombre: string,
  hoja = 'Datos'
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios · Inventario'
  wb.created = new Date()
  // Excel no admite : \ / ? * [ ] en el nombre de la hoja, ni más de 31 letras.
  const ws = wb.addWorksheet(hoja.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Datos', {
    views: [{ state: 'frozen', ySplit: bloque.encabezados.length ? 1 : 0 }],
  })

  if (bloque.encabezados.length) ws.addRow(bloque.encabezados)
  for (const fila of bloque.filas) ws.addRow(fila.map(valorExcel))

  const anchos = (bloque.encabezados.length ? [bloque.encabezados, ...bloque.filas] : bloque.filas)
    .reduce<number[]>((acc, fila) => {
      fila.forEach((c, i) => {
        acc[i] = Math.max(acc[i] ?? 10, Math.min(60, celdaPlana(c).length + 2))
      })
      return acc
    }, [])
  anchos.forEach((ancho, i) => {
    ws.getColumn(i + 1).width = ancho
  })

  if (bloque.encabezados.length) {
    const encabezado = ws.getRow(1)
    encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    encabezado.alignment = { vertical: 'middle' }
    encabezado.height = 20
    encabezado.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1B5E20' } } }
    })
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** CSV con BOM para que Excel en español abra las tildes bien. */
export function aCSV(bloque: BloqueCopiado): string {
  const filas = bloque.encabezados.length
    ? [bloque.encabezados, ...bloque.filas]
    : bloque.filas
  return filas
    .map((f) => f.map((c) => `"${celdaPlana(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')
}

export function descargarCSV(bloque: BloqueCopiado, nombre: string): void {
  const blob = new Blob(['\uFEFF' + aCSV(bloque)], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
