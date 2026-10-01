// Excel del informe de un cargue de inventario físico (/inventario-fisico/[id]).
//
// Hojas, todas por ítem y luego alfabético:
//   · Resumen            encabezado del cargue y KPIs contra el anterior y el sistema.
//   · Comparativo        cantidad en cada conteo anterior + el actual, diferencias
//                        vs. el anterior, vs. el promedio y vs. el sistema.
//   · Conteo vs sistema  lo contado frente al stock que tenía el sistema.
//   · Faltantes          faltantes físicos (contado < sistema) y los que dejaron
//                        de venir respecto al conteo anterior.
//   · No hallados        activos del catálogo que no vinieron en el archivo.
//
// Las celdas sin cantidad NO se escriben como 0: van como texto "sin cantidad"
// (y "no vino" / "no estaba" cuando el producto no figura en ese conteo).
// Recibe ExcelJS por parámetro para poder ejecutarlo también desde Node.

import type ExcelJSNS from 'exceljs'
import { ordenarPorItem } from './orden'
import { ETIQUETA_COMPARACION, ETIQUETA_SISTEMA } from '@/lib/inventario-fisico'
import type { CeldaConteo, FilaInforme, InformeCargue } from '@/lib/inventario-fisico-informe'

type ExcelJS = typeof ExcelJSNS
type Valor = string | number | null

const VERDE = 'FF2E7D32'
const VERDE_OSCURO = 'FF1B5E20'
// Decimales solo donde hay decimales ("#,##0.##" deja un punto colgando en los enteros)
const F_NUM = '#,##0.00;[Red]-#,##0.00'
const F_INT = '#,##0;[Red]-#,##0'
const F_COP = '"$"#,##0;[Red]-"$"#,##0'

interface Col { header: string; width: number; numFmt?: string }

function fechaLarga(f: string) {
  return new Date(f + 'T12:00:00-05:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
}

/** Texto o número de una celda de conteo (nunca 0 si no hubo cantidad). */
export function valorCelda(c: CeldaConteo | undefined): Valor {
  if (!c || c.estado === 'AUSENTE') return 'no estaba'
  if (c.estado === 'NO_HALLADO') return 'no vino'
  if (c.estado === 'SIN_CANTIDAD' || c.cantidad === null) return 'sin cantidad'
  return c.cantidad
}

const redondo = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100)
const unid = (v: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v)

function hoja(wb: ExcelJSNS.Workbook, nombre: string, cols: Col[], filas: Valor[][]) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] })
  ws.columns = cols.map(c => ({ header: c.header, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : undefined }))
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.alignment = { vertical: 'middle', wrapText: true }
  h.height = 32
  h.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    c.border = { bottom: { style: 'thin', color: { argb: VERDE_OSCURO } } }
  })
  for (const f of filas) {
    const row = ws.addRow(f)
    // Los rótulos ("sin cantidad", "no vino") en gris y cursiva
    f.forEach((v, i) => {
      if (typeof v === 'number' && Number.isInteger(v) && cols[i].numFmt === F_NUM) row.getCell(i + 1).numFmt = F_INT
      if (typeof v === 'string' && cols[i].numFmt) {
        const cell = row.getCell(i + 1)
        cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }
        cell.alignment = { horizontal: 'right' }
      }
    })
  }
  if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}

const etqComp = (f: FilaInforme) => (f.estadoAnterior ? ETIQUETA_COMPARACION[f.estadoAnterior] : '')
const etqSis = (f: FilaInforme) => (f.estadoSistema ? ETIQUETA_SISTEMA[f.estadoSistema] : 'No figura en este conteo')

export function nombreArchivoInforme(inf: InformeCargue) {
  const limpio = inf.actual.periodo.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `informe-inventario-fisico-${limpio}.xlsx`
}

export function construirLibroInforme(ExcelJSMod: ExcelJS, inf: InformeCargue): ExcelJSNS.Workbook {
  const wb = new ExcelJSMod.Workbook()
  wb.creator = 'Conserjes Inmobiliarios · Inventario'
  wb.created = new Date()
  const { actual, anteriores, anteriorInmediato: ant, vsAnterior: va, vsSistema: vs } = inf
  const filas = ordenarPorItem(inf.filas, f => f.codigo, f => f.nombre)

  // ── Resumen ────────────────────────────────────────────────────────────────
  const wsR = wb.addWorksheet('Resumen')
  wsR.columns = [{ width: 46 }, { width: 22 }, { width: 60 }]
  const titulo = wsR.addRow([`Informe del inventario físico ${actual.periodo}`])
  titulo.font = { bold: true, size: 14, color: { argb: VERDE_OSCURO } }
  wsR.addRow([])
  const seccion = (t: string) => {
    const r = wsR.addRow([t])
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
  }
  const dato = (k: string, v: Valor, nota = '', fmt?: string) => {
    const r = wsR.addRow([k, v, nota])
    r.getCell(1).font = { color: { argb: 'FF4B5563' } }
    if (fmt && typeof v === 'number') r.getCell(2).numFmt = fmt === F_NUM && Number.isInteger(v) ? F_INT : fmt
    r.getCell(3).font = { italic: true, color: { argb: 'FF9CA3AF' } }
  }

  seccion('Cargue')
  dato('Periodo', actual.periodo)
  dato('Fecha de corte', fechaLarga(actual.fecha_corte))
  dato('Archivo', actual.archivo_nombre ?? '')
  if (actual.observacion) dato('Observación', actual.observacion)
  if (actual.historico) dato('Histórico', 'Sí', 'Foto reconstruida después de aplicar el cruce')
  dato('Productos en el archivo', actual.total_items, '', F_NUM)
  dato('Con cantidad', actual.items_con_cantidad, '', F_NUM)
  dato('En cero', actual.items_en_cero, '', F_NUM)
  dato('Celda vacía (sin cantidad)', actual.total_items - actual.items_con_cantidad, 'no se toman como 0', F_NUM)
  dato('Unidades contadas', actual.total_unidades, '', F_NUM)
  dato('Stock ajustado', actual.items_ajustados, '', F_NUM)
  dato('Productos nuevos', actual.items_nuevos, '', F_NUM)
  dato('No hallados', actual.items_no_hallados, 'activos que no vinieron en el archivo', F_NUM)
  dato('Conteos anteriores comparados', anteriores.length,
    anteriores.map(a => `${a.periodo} (${a.fecha_corte})`).join(' · ') || 'Es el primer conteo: solo hay conteo vs sistema')
  if (inf.posteriores.length) {
    dato('Conteos posteriores (no entran)', inf.posteriores.length, inf.posteriores.map(a => a.periodo).join(' · '))
  }

  wsR.addRow([])
  if (ant && va) {
    seccion(`Contra el anterior: ${ant.periodo} (corte ${ant.fecha_corte})`)
    dato('Dejaron de venir (faltantes)', va.faltantes, `estaban en ${ant.periodo} y no vinieron`, F_NUM)
    dato('Nuevos en el conteo', va.nuevos, `no estaban en ${ant.periodo}`, F_NUM)
    dato('Se agotaron', va.agotados, 'tenían existencias y quedaron en cero', F_NUM)
    dato('Repuestos', va.repuestos, 'estaban en cero y ahora tienen', F_NUM)
    dato('Bajaron', va.bajaron, '', F_NUM)
    dato('Subieron', va.subieron, '', F_NUM)
    dato('Sin cambio', va.iguales, '', F_NUM)
    dato('Sin dato', va.sinDato, 'una de las dos celdas vino vacía', F_NUM)
    dato(`Unidades ${ant.periodo}`, redondo(va.unidadesAnterior), '', F_NUM)
    dato(`Unidades ${actual.periodo}`, redondo(va.unidadesActual), '', F_NUM)
    dato('Variación de unidades', redondo(va.unidadesActual - va.unidadesAnterior), '', F_NUM)
    dato('Valor de las bajas', Math.round(va.valorPerdido), 'a precio de lista', F_COP)
    dato('Valor de las alzas', Math.round(va.valorGanado), 'a precio de lista', F_COP)
  } else {
    seccion('Contra el anterior')
    dato('Sin conteo anterior', '', 'Este es el primer conteo: el informe solo trae conteo vs sistema')
  }

  wsR.addRow([])
  seccion('Contra el sistema (stock justo antes de aplicar el conteo)')
  dato('Faltantes físicos', vs.faltantes, `${unid(vs.unidadesFaltantes)} unidades`, F_NUM)
  dato('Sobrantes', vs.sobrantes, `+${unid(vs.unidadesSobrantes)} unidades`, F_NUM)
  dato('Cuadran', vs.cuadran, 'contado = sistema', F_NUM)
  dato('No hallados', vs.noHallados, `${unid(vs.unidadesNoHallados)} unidades en el sistema`, F_NUM)
  dato('Sin cantidad', vs.sinCantidad, 'celda vacía en el archivo', F_NUM)
  if (vs.sinSistema) dato('Sin dato del sistema', vs.sinSistema, 'contados sin stock previo conocido', F_NUM)
  dato('Exactitud', vs.exactitud === null ? null : Math.round(vs.exactitud * 10) / 10, '% de contados que cuadran', '0.0"%"')
  dato('Valor faltantes físicos', Math.round(vs.valorFaltantes), 'a precio de lista', F_COP)
  dato('Valor sobrantes', Math.round(vs.valorSobrantes), 'a precio de lista', F_COP)
  dato('Valor del stock no hallado', Math.round(vs.valorNoHallados), 'a precio de lista', F_COP)
  dato('Con diferencias recurrentes', inf.recurrentes, 'diferencia vs sistema ahora y en algún conteo anterior', F_NUM)

  // ── Comparativo ────────────────────────────────────────────────────────────
  const colsConteos: Col[] = [...anteriores, actual].map(i => ({
    header: `${i.periodo}${i.id === actual.id ? ' (actual)' : ''}\n${i.fecha_corte}`, width: 16, numFmt: F_NUM,
  }))
  hoja(wb, 'Comparativo', [
    { header: 'ÍTEM', width: 8 },
    { header: 'PRODUCTO', width: 44 },
    { header: 'PRESENTACIÓN', width: 16 },
    ...colsConteos,
    ...(ant ? [
      { header: `DIF. VS ${ant.periodo}`, width: 14, numFmt: F_NUM },
      { header: 'ESTADO VS ANTERIOR', width: 18 },
      { header: 'PROMEDIO ANTERIORES', width: 14, numFmt: F_NUM },
      { header: 'DIF. VS PROMEDIO', width: 14, numFmt: F_NUM },
    ] : []),
    { header: 'STOCK SISTEMA', width: 13, numFmt: F_NUM },
    { header: 'DIF. VS SISTEMA', width: 13, numFmt: F_NUM },
    { header: 'ESTADO VS SISTEMA', width: 18 },
    { header: 'VALOR DIF. SISTEMA', width: 16, numFmt: F_COP },
    ...(ant ? [{ header: 'CONTEOS ANTERIORES CON DIF.', width: 14, numFmt: '0' }] : []),
  ], filas.map(f => [
    f.codigo, f.nombre, f.presentacion ?? '',
    ...[...anteriores, actual].map(i => valorCelda(f.celdas[i.id])),
    ...(ant ? [
      redondo(f.difAnterior), etqComp(f), redondo(f.promedioAnteriores), redondo(f.difPromedio),
    ] : []),
    f.stockSistema, redondo(f.difSistema), etqSis(f),
    f.valorDifSistema === null ? null : Math.round(f.valorDifSistema),
    ...(ant ? [f.difSistemaAntes] : []),
  ]))

  // ── Conteo vs sistema ──────────────────────────────────────────────────────
  const delActual = filas.filter(f => f.estadoSistema !== null)
  hoja(wb, 'Conteo vs sistema', [
    { header: 'ÍTEM', width: 8 },
    { header: 'PRODUCTO', width: 44 },
    { header: 'PRESENTACIÓN', width: 16 },
    { header: 'STOCK SISTEMA', width: 13, numFmt: F_NUM },
    { header: 'CONTADO', width: 13, numFmt: F_NUM },
    { header: 'DIFERENCIA', width: 13, numFmt: F_NUM },
    { header: 'ESTADO', width: 16 },
    { header: 'PRECIO', width: 14, numFmt: F_COP },
    { header: 'VALOR DIFERENCIA', width: 16, numFmt: F_COP },
    { header: 'RECURRENTE', width: 12 },
  ], delActual.map(f => [
    f.codigo, f.nombre, f.presentacion ?? '',
    f.stockSistema, valorCelda(f.actual), redondo(f.difSistema), etqSis(f),
    f.precio, f.valorDifSistema === null ? null : Math.round(f.valorDifSistema),
    f.recurrente ? `Sí (${f.difSistemaAntes} antes)` : '',
  ]))

  // ── Faltantes ──────────────────────────────────────────────────────────────
  const faltantes = filas.filter(f => f.estadoSistema === 'FALTANTE' || f.estadoAnterior === 'FALTANTE')
  const periodo = (id: string | null) => [...anteriores, actual].find(i => i.id === id)?.periodo ?? ''
  hoja(wb, 'Faltantes', [
    { header: 'ÍTEM', width: 8 },
    { header: 'PRODUCTO', width: 44 },
    { header: 'PRESENTACIÓN', width: 16 },
    { header: 'TIPO', width: 34 },
    { header: 'ÚLTIMO CONTEO CON DATO', width: 18 },
    { header: 'CANTIDAD ANTES', width: 13, numFmt: F_NUM },
    { header: 'STOCK SISTEMA', width: 13, numFmt: F_NUM },
    { header: 'CONTADO', width: 13, numFmt: F_NUM },
    { header: 'UNIDADES FALTANTES', width: 13, numFmt: F_NUM },
    { header: 'PRECIO', width: 14, numFmt: F_COP },
    { header: 'VALOR', width: 16, numFmt: F_COP },
  ], faltantes.map(f => {
    const fisico = f.estadoSistema === 'FALTANTE'
    const unidades = fisico ? f.difSistema : f.difAnterior
    const valor = fisico ? f.valorDifSistema : f.valorDifAnterior
    return [
      f.codigo, f.nombre, f.presentacion ?? '',
      fisico ? 'Faltante físico (contado < sistema)' : `Dejó de venir (estaba en ${ant?.periodo ?? ''})`,
      periodo(f.ultimoAnteriorConDato),
      ant ? valorCelda(f.celdas[ant.id]) : null,
      f.stockSistema, valorCelda(f.actual), redondo(unidades), f.precio,
      valor === null ? null : Math.round(valor),
    ]
  }))

  // ── No hallados ────────────────────────────────────────────────────────────
  const noHallados = filas.filter(f => f.estadoSistema === 'NO_HALLADO')
  hoja(wb, 'No hallados', [
    { header: 'ÍTEM', width: 8 },
    { header: 'PRODUCTO', width: 44 },
    { header: 'PRESENTACIÓN', width: 16 },
    { header: 'STOCK SISTEMA', width: 13, numFmt: F_NUM },
    { header: 'PRECIO', width: 14, numFmt: F_COP },
    { header: 'VALOR STOCK', width: 16, numFmt: F_COP },
    { header: 'ÚLTIMO CONTEO EN QUE VINO', width: 18 },
    { header: 'CANTIDAD ESE CONTEO', width: 13, numFmt: F_NUM },
  ], noHallados.map(f => [
    f.codigo, f.nombre, f.presentacion ?? '',
    f.stockSistema, f.precio,
    f.stockSistema !== null && f.precio ? Math.round(f.stockSistema * f.precio) : null,
    f.ultimoAnteriorConDato ? periodo(f.ultimoAnteriorConDato) : 'nunca',
    f.ultimoAnteriorConDato ? valorCelda(f.celdas[f.ultimoAnteriorConDato]) : null,
  ]))

  return wb
}

/** Arma el libro y lo descarga en el navegador. */
export async function descargarInformeCargue(inf: InformeCargue) {
  const ExcelJSMod = (await import('exceljs')).default
  const wb = construirLibroInforme(ExcelJSMod, inf)
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivoInforme(inf)
  a.click()
  URL.revokeObjectURL(url)
}
