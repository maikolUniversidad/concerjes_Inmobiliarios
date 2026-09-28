// Reporte "Inventario, consumo y proyección" en Excel.
//
// Hojas (todas por ítem y nombre, salvo los rankings "Top 20"):
//   · Inventario     stock real, reservado, disponible (real − reservado),
//                    diferencia vs. mínimo y valores, con fórmulas.
//   · Consumo        consumo neto por mes de cada producto (últimos N meses).
//   · Proyección     consumo promedio, desviación, tendencia, días de
//                    cobertura, fecha de agotamiento, compra sugerida y stock
//                    proyectado a 3 meses sin entradas.
//   · Estadísticas   parámetros (los días a cubrir se pueden cambiar en el
//                    propio Excel), resumen con fórmulas, distribución por
//                    rotación y los Top 20 de déficit y de consumo.
//   · Conteos físicos (si hay y el usuario puede verlos) conteo vs. sistema
//                    del último inventario físico.
//
// La carga usa el cliente de navegador de Supabase (respeta RLS) y pagina
// todo con `traerTodo`. El armado del libro recibe ExcelJS por parámetro para
// poder ejecutarlo también desde un script de verificación en Node.

import type ExcelJSNS from 'exceljs'
import { traerTodo } from '@/lib/supabase/paginado'
import { ordenarPorItem } from './orden'
import {
  consumoPorMes, detectarInicioDatos, proyectarProducto, signoConsumo, ventanaMeses, claveMes,
  type ConsumoProducto, type Mes, type MovConsumo, type ResultadoProyeccion,
} from './proyeccion'

type ExcelJS = typeof ExcelJSNS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface OpcionesProyeccion {
  /** Meses de historia a analizar (incluye el mes en curso). */
  meses: number
  /** Días que debe cubrir la compra sugerida. */
  diasCompra: number
  /** Fecha de corte; por defecto, ahora. */
  hoy?: Date
}

export interface ProductoProy {
  id: string
  codigo: number | null
  nombre: string
  presentacion: string
  tipo: string
  cat: string
  precio: number
  minimo: number
  real: number
  reservado: number
  disponible: number
  ordenes: number
}

export interface ItemConteo {
  codigo: number | null
  nombre: string
  presentacion: string
  estado: string
  contada: number | null
  sistema: number | null
  precio: number
  productoId: string | null
}

export interface ConteoFisico {
  periodo: string
  fechaCorte: string
  items: ItemConteo[]
}

export interface DatosProyeccion {
  hoy: Date
  diasCompra: number
  meses: Mes[]
  inicioDatos: Date | null
  productos: ProductoProy[]
  consumo: Map<string, ConsumoProducto>
  movimientosLeidos: number
  conteo: ConteoFisico | null
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

// ─── Carga ────────────────────────────────────────────────────────────────────

export async function cargarDatosProyeccion(
  supabase: DB,
  opciones: OpcionesProyeccion,
  progreso: (paso: string) => void = () => {},
): Promise<DatosProyeccion> {
  const hoy = opciones.hoy ?? new Date()
  const ventanaBruta = ventanaMeses(hoy, opciones.meses)
  const desde = ventanaBruta[0].inicio

  progreso('Leyendo stock proyectado y catálogo…')
  const [vista, catalogo] = await Promise.all([
    traerTodo<Fila>((d, h) => supabase
      .from('v_stock_proyectado')
      .select('producto_id, nombre_estandar, presentacion, stock_real, comprometido, disponible, ordenes_en_cola')
      .order('producto_id')
      .range(d, h), { etiqueta: 'No se pudo leer el stock proyectado' }),
    traerTodo<Fila>((d, h) => supabase
      .from('productos')
      .select('id, codigo, nombre_estandar, presentacion, tipo_insumo, cat_rotacion, precio_lista, stock_minimo_def, activo')
      .eq('activo', true)
      .order('codigo', { ascending: true, nullsFirst: false })
      .order('nombre_estandar')
      .order('id')
      .range(d, h), { etiqueta: 'No se pudieron leer los productos' }),
  ])

  const porId = new Map(catalogo.map(p => [p.id as string, p]))
  const productos: ProductoProy[] = []
  for (const v of vista) {
    const p = porId.get(v.producto_id)
    if (!p) continue // la vista ya filtra activos; esto cubre RLS/carreras
    productos.push({
      id: v.producto_id,
      codigo: p.codigo ?? null,
      nombre: v.nombre_estandar ?? p.nombre_estandar ?? '',
      presentacion: v.presentacion ?? p.presentacion ?? '',
      tipo: p.tipo_insumo ?? '',
      cat: p.cat_rotacion ?? '',
      precio: num(p.precio_lista),
      minimo: num(p.stock_minimo_def),
      real: num(v.stock_real),
      reservado: num(v.comprometido),
      disponible: num(v.disponible),
      ordenes: num(v.ordenes_en_cola),
    })
  }

  progreso('Leyendo movimientos de consumo…')
  const movsCrudos = await traerTodo<Fila>((d, h) => supabase
    .from('movimientos')
    .select('id, producto_id, tipo, cantidad, created_at')
    .in('tipo', ['SALIDA', 'TRASLADO', 'DEVOLUCION'])
    .gte('created_at', desde.toISOString())
    .lt('created_at', hoy.toISOString())
    .order('created_at')
    .order('id')
    .range(d, h), { maximo: 200_000, etiqueta: 'No se pudieron leer los movimientos' })
  const movs: MovConsumo[] = movsCrudos.map(m => ({
    productoId: m.producto_id, tipo: m.tipo, cantidad: num(m.cantidad), fecha: m.created_at,
  }))

  // Primer mes con actividad real (descarta el arranque del sistema).
  const conteoMes = new Map<string, number>(ventanaBruta.map(m => [m.clave, 0]))
  for (const m of movs) {
    if (signoConsumo(m.tipo) <= 0) continue
    const k = claveMes(new Date(m.fecha))
    if (conteoMes.has(k)) conteoMes.set(k, (conteoMes.get(k) ?? 0) + 1)
  }
  const inicioDetectado = detectarInicioDatos(conteoMes)
  const inicioDatos = inicioDetectado && inicioDetectado > desde ? inicioDetectado : null
  const meses = ventanaMeses(hoy, opciones.meses, inicioDatos)

  progreso('Leyendo el último conteo físico…')
  const conteo = await cargarUltimoConteo(supabase)

  return {
    hoy,
    diasCompra: opciones.diasCompra,
    meses,
    inicioDatos,
    productos: ordenarPorItem(productos, p => p.codigo, p => p.nombre),
    consumo: consumoPorMes(movs, meses),
    movimientosLeidos: movs.length,
    conteo,
  }
}

/** Último inventario físico (por fecha de corte). null si no hay o no hay permiso. */
async function cargarUltimoConteo(supabase: DB): Promise<ConteoFisico | null> {
  try {
    const { data: inv, error } = await supabase
      .from('inventarios_fisicos')
      .select('id, periodo, fecha_corte')
      .order('fecha_corte', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !inv) return null
    const items = await traerTodo<Fila>((d, h) => supabase
      .from('inventario_fisico_items')
      .select('id, producto_id, codigo, nombre, presentacion, estado, cantidad_contada, stock_sistema, precio_unitario')
      .eq('inventario_id', inv.id)
      .order('id')
      .range(d, h))
    return {
      periodo: inv.periodo,
      fechaCorte: inv.fecha_corte,
      items: ordenarPorItem(items.map(i => ({
        codigo: i.codigo ?? null,
        nombre: i.nombre ?? '',
        presentacion: i.presentacion ?? '',
        estado: i.estado ?? '',
        contada: i.cantidad_contada === null || i.cantidad_contada === undefined ? null : num(i.cantidad_contada),
        sistema: i.stock_sistema === null || i.stock_sistema === undefined ? null : num(i.stock_sistema),
        precio: num(i.precio_unitario),
        productoId: i.producto_id ?? null,
      })), i => i.codigo, i => i.nombre),
    }
  } catch {
    return null // sin permiso ver_inventario_fisico o tabla no disponible: se omite la hoja
  }
}

// ─── Libro ────────────────────────────────────────────────────────────────────

const VERDE = 'FF2E7D32'
const VERDE_OSCURO = 'FF1B5E20'
const ROJO_SUAVE = 'FFFDECEA'
const ROJO = 'FFC62828'
const AMARILLO = 'FFFFF8E1'
const GRIS = 'FF757575'

const F_ENTERO = '#,##0;[Red]-#,##0'
const F_DEC = '#,##0.##;[Red]-#,##0.##'
const F_DEC1 = '#,##0.0;[Red]-#,##0.0'
const F_COP = '"$" #,##0;[Red]-"$" #,##0'
const F_PCT = '0.0%;[Red]-0.0%'
const F_FECHA = 'dd/mm/yyyy'

const HOJA_EST = 'Estadísticas'
/** Celda de parámetro con los días a cubrir (editable en el Excel). */
const CELDA_DIAS = `'${HOJA_EST}'!$B$6`

function letra(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

interface Col { header: string; key: string; width: number; numFmt?: string }

/** Encabezado verde, congelado, con autofiltro; devuelve la hoja. */
function hojaDatos(wb: ExcelJSNS.Workbook, nombre: string, cols: Col[]): ExcelJSNS.Worksheet {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] })
  ws.columns = cols.map(c => ({
    header: c.header, key: c.key, width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }))
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.alignment = { vertical: 'middle', wrapText: true }
  h.height = 32
  h.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    c.border = { bottom: { style: 'thin', color: { argb: VERDE_OSCURO } } }
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}

/** Fila de totales con SUBTOTAL(109) (respeta el autofiltro). */
function filaTotales(ws: ExcelJSNS.Worksheet, fila: number, ultimaDatos: number, columnas: number[], resultados: Record<number, number>) {
  const row = ws.getRow(fila)
  row.getCell(1).value = 'TOTAL'
  for (const c of columnas) {
    const L = letra(c)
    row.getCell(c).value = { formula: `SUBTOTAL(109,${L}2:${L}${ultimaDatos})`, result: resultados[c] ?? 0 }
  }
  row.font = { bold: true }
  row.eachCell({ includeEmpty: false }, c => {
    c.border = { top: { style: 'double', color: { argb: VERDE_OSCURO } } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } }
  })
}

/** Resalta en rojo suave las filas cuya celda `$Lx` es negativa. */
function rojoSiNegativo(ws: ExcelJSNS.Worksheet, colLetra: string, ultimaDatos: number, ultimaCol: number) {
  if (ultimaDatos < 2) return
  ws.addConditionalFormatting({
    ref: `A2:${letra(ultimaCol)}${ultimaDatos}`,
    rules: [{
      type: 'expression', priority: 1,
      formulae: [`$${colLetra}2<0`],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: ROJO_SUAVE } }, font: { color: { argb: ROJO } } },
    }],
  })
}

const fechaCorta = (d: Date) => d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Fecha "de calendario" para Excel (sin corrimiento por zona horaria). */
const fechaExcel = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))

function estadoInventario(p: ProductoProy): string {
  if (p.disponible < 0) return 'NEGATIVO'
  if (p.disponible === 0) return 'AGOTADO'
  if (p.minimo > 0 && p.disponible < p.minimo) return 'BAJO MÍNIMO'
  return 'OK'
}

export interface LibroProyeccion {
  wb: ExcelJSNS.Workbook
  filas: number
  proyecciones: Map<string, ResultadoProyeccion>
}

export function construirLibroProyeccion(ExcelJSMod: ExcelJS, d: DatosProyeccion): LibroProyeccion {
  const wb = new ExcelJSMod.Workbook()
  wb.creator = 'Conserjes Inmobiliarios · Inventario'
  wb.created = new Date()

  const prods = d.productos
  const n = prods.length
  const ult = n + 1 // última fila de datos
  const vacio: ConsumoProducto = { salidas: d.meses.map(() => 0), devoluciones: d.meses.map(() => 0), neto: d.meses.map(() => 0) }
  const proy = new Map<string, ResultadoProyeccion>()
  for (const p of prods) {
    const c = d.consumo.get(p.id) ?? vacio
    proy.set(p.id, proyectarProducto({ disponible: p.disponible, neto: c.neto, meses: d.meses, hoy: d.hoy, diasCompra: d.diasCompra }))
  }
  // Etiquetas de los 3 meses siguientes, con el mismo formato que las de la ventana.
  const mesesProy = ventanaMeses(new Date(d.hoy.getFullYear(), d.hoy.getMonth() + 3, 1), 3).map(m => m.etiqueta)

  // ── Inventario ─────────────────────────────────────────────────────────────
  const wsInv = hojaDatos(wb, 'Inventario', [
    { header: 'Ítem', key: 'item', width: 8, numFmt: '0' },
    { header: 'Producto', key: 'producto', width: 44 },
    { header: 'Presentación', key: 'presentacion', width: 18 },
    { header: 'Tipo de insumo', key: 'tipo', width: 15 },
    { header: 'Cat.', key: 'cat', width: 6 },
    { header: 'Stock real', key: 'real', width: 12, numFmt: F_DEC },
    { header: 'Reservado (pedidos sin despachar)', key: 'reservado', width: 16, numFmt: F_DEC },
    { header: 'Disponible real (real − reservado)', key: 'disponible', width: 16, numFmt: F_DEC },
    { header: 'Stock mínimo', key: 'minimo', width: 11, numFmt: F_DEC },
    { header: 'Diferencia vs. mínimo', key: 'dif', width: 13, numFmt: F_DEC },
    { header: 'Órdenes en cola', key: 'ordenes', width: 10, numFmt: F_ENTERO },
    { header: 'Precio lista', key: 'precio', width: 13, numFmt: F_COP },
    { header: 'Valor stock real', key: 'v_real', width: 16, numFmt: F_COP },
    { header: 'Valor reservado', key: 'v_res', width: 16, numFmt: F_COP },
    { header: 'Valor disponible', key: 'v_disp', width: 16, numFmt: F_COP },
    { header: 'Estado', key: 'estado', width: 13 },
  ])
  prods.forEach((p, i) => {
    const r = i + 2
    wsInv.addRow({
      item: p.codigo, producto: p.nombre, presentacion: p.presentacion, tipo: p.tipo, cat: p.cat,
      real: p.real, reservado: p.reservado,
      disponible: { formula: `F${r}-G${r}`, result: p.disponible },
      minimo: p.minimo,
      dif: { formula: `H${r}-I${r}`, result: p.disponible - p.minimo },
      ordenes: p.ordenes, precio: p.precio || null,
      v_real: { formula: `F${r}*L${r}`, result: p.real * p.precio },
      v_res: { formula: `G${r}*L${r}`, result: p.reservado * p.precio },
      v_disp: { formula: `H${r}*L${r}`, result: p.disponible * p.precio },
      estado: estadoInventario(p),
    })
  })
  const suma = (f: (p: ProductoProy) => number) => prods.reduce((a, p) => a + f(p), 0)
  filaTotales(wsInv, ult + 1, ult, [6, 7, 8, 13, 14, 15], {
    6: suma(p => p.real), 7: suma(p => p.reservado), 8: suma(p => p.disponible),
    13: suma(p => p.real * p.precio), 14: suma(p => p.reservado * p.precio), 15: suma(p => p.disponible * p.precio),
  })
  rojoSiNegativo(wsInv, 'H', ult, 16)

  // ── Consumo ────────────────────────────────────────────────────────────────
  const nM = d.meses.length
  const colsMes: Col[] = d.meses.map((m, i) => ({
    header: m.diasObservados < 1 ? `${m.etiqueta} (fuera del análisis)` : m.diasObservados < 28 ? `${m.etiqueta} (${Math.round(m.diasObservados)} d)` : m.etiqueta,
    key: `m${i}`, width: 12, numFmt: F_DEC,
  }))
  const wsCon = hojaDatos(wb, 'Consumo', [
    { header: 'Ítem', key: 'item', width: 8, numFmt: '0' },
    { header: 'Producto', key: 'producto', width: 44 },
    { header: 'Presentación', key: 'presentacion', width: 18 },
    ...colsMes,
    { header: 'Total consumo neto', key: 'total', width: 14, numFmt: F_DEC },
    { header: 'Salidas', key: 'salidas', width: 12, numFmt: F_DEC },
    { header: 'Devoluciones', key: 'devol', width: 13, numFmt: F_DEC },
    { header: 'Promedio mensual', key: 'prom', width: 13, numFmt: F_DEC1 },
  ])
  const cIni = 4, cFin = 3 + nM
  prods.forEach((p, i) => {
    const r = i + 2
    const c = d.consumo.get(p.id) ?? vacio
    const fila: Fila = { item: p.codigo, producto: p.nombre, presentacion: p.presentacion }
    c.neto.forEach((v, j) => { fila[`m${j}`] = v })
    fila.total = { formula: `SUM(${letra(cIni)}${r}:${letra(cFin)}${r})`, result: c.neto.reduce((a, b) => a + b, 0) }
    fila.salidas = c.salidas.reduce((a, b) => a + b, 0)
    fila.devol = c.devoluciones.reduce((a, b) => a + b, 0)
    fila.prom = proy.get(p.id)?.consumoMensual ?? 0
    wsCon.addRow(fila)
  })
  const totCon: Record<number, number> = {}
  for (let j = 0; j < nM; j++) totCon[cIni + j] = prods.reduce((a, p) => a + (d.consumo.get(p.id)?.neto[j] ?? 0), 0)
  totCon[cFin + 1] = Object.values(totCon).reduce((a, b) => a + b, 0)
  totCon[cFin + 2] = prods.reduce((a, p) => a + (d.consumo.get(p.id)?.salidas.reduce((x, y) => x + y, 0) ?? 0), 0)
  totCon[cFin + 3] = prods.reduce((a, p) => a + (d.consumo.get(p.id)?.devoluciones.reduce((x, y) => x + y, 0) ?? 0), 0)
  totCon[cFin + 4] = prods.reduce((a, p) => a + (proy.get(p.id)?.consumoMensual ?? 0), 0)
  filaTotales(wsCon, ult + 1, ult, Object.keys(totCon).map(Number), totCon)

  // ── Proyección ─────────────────────────────────────────────────────────────
  const wsPro = hojaDatos(wb, 'Proyección', [
    { header: 'Ítem', key: 'item', width: 8, numFmt: '0' },                                // A
    { header: 'Producto', key: 'producto', width: 44 },                                    // B
    { header: 'Presentación', key: 'presentacion', width: 18 },                            // C
    { header: 'Cat.', key: 'cat', width: 6 },                                              // D
    { header: 'Disponible real', key: 'disp', width: 13, numFmt: F_DEC },                  // E
    { header: 'Consumo prom. mensual', key: 'prom', width: 13, numFmt: F_DEC1 },           // F
    { header: 'Desv. estándar mensual', key: 'desv', width: 13, numFmt: F_DEC1 },          // G
    { header: 'Coef. de variación', key: 'cv', width: 11, numFmt: F_PCT },                 // H
    { header: 'Consumo diario', key: 'diario', width: 11, numFmt: '#,##0.00' },            // I
    { header: 'Días de cobertura', key: 'cobertura', width: 11, numFmt: F_ENTERO },        // J
    { header: 'Fecha estimada de agotamiento', key: 'agota', width: 14, numFmt: F_FECHA }, // K
    { header: 'Tendencia (u/mes por mes)', key: 'tend', width: 13, numFmt: F_DEC1 },       // L
    { header: 'Tendencia %', key: 'tend_pct', width: 10, numFmt: F_PCT },                  // M
    { header: 'R² tendencia', key: 'r2', width: 9, numFmt: '0.00' },                        // N
    { header: 'Sugerido a comprar (días de Estadísticas!B6)', key: 'sugerido', width: 16, numFmt: F_DEC }, // O
    { header: 'Precio lista', key: 'precio', width: 13, numFmt: F_COP },                   // P
    { header: 'Valor sugerido', key: 'v_sug', width: 15, numFmt: F_COP },                  // Q
    { header: `Stock fin ${mesesProy[0]} (sin entradas)`, key: 's1', width: 14, numFmt: F_DEC }, // R
    { header: `Stock fin ${mesesProy[1]} (sin entradas)`, key: 's2', width: 14, numFmt: F_DEC }, // S
    { header: `Stock fin ${mesesProy[2]} (sin entradas)`, key: 's3', width: 14, numFmt: F_DEC }, // T
    { header: 'Estado', key: 'estado', width: 13 },                                        // U
    { header: 'Meses con datos', key: 'meses', width: 9, numFmt: '0' },                   // V
  ])
  prods.forEach((p, i) => {
    const r = i + 2
    const x = proy.get(p.id) as ResultadoProyeccion
    wsPro.addRow({
      item: p.codigo, producto: p.nombre, presentacion: p.presentacion, cat: p.cat,
      disp: p.disponible,
      prom: x.consumoMensual,
      desv: x.desviacion,
      cv: x.coefVariacion,
      diario: x.consumoDiario,
      cobertura: {
        formula: `IF(E${r}<=0,0,IF(I${r}>0,E${r}/I${r},""))`,
        result: x.diasCobertura === null ? '' : x.diasCobertura,
      },
      agota: x.fechaAgotamiento ? fechaExcel(x.fechaAgotamiento) : null,
      tend: x.tendencia,
      tend_pct: x.tendenciaPct,
      r2: x.r2,
      sugerido: { formula: `MAX(0,I${r}*${CELDA_DIAS}-E${r})`, result: x.sugerido },
      precio: p.precio || null,
      v_sug: { formula: `O${r}*P${r}`, result: x.sugerido * p.precio },
      s1: x.stockProyectado[0], s2: x.stockProyectado[1], s3: x.stockProyectado[2],
      estado: x.estado,
      meses: x.mesesValidos,
    })
  })
  filaTotales(wsPro, ult + 1, ult, [5, 6, 15, 17, 18, 19, 20], {
    5: suma(p => p.disponible),
    6: suma(p => proy.get(p.id)?.consumoMensual ?? 0),
    15: suma(p => proy.get(p.id)?.sugerido ?? 0),
    17: suma(p => (proy.get(p.id)?.sugerido ?? 0) * p.precio),
    18: suma(p => proy.get(p.id)?.stockProyectado[0] ?? 0),
    19: suma(p => proy.get(p.id)?.stockProyectado[1] ?? 0),
    20: suma(p => proy.get(p.id)?.stockProyectado[2] ?? 0),
  })
  rojoSiNegativo(wsPro, 'E', ult, 22)
  if (n > 0) {
    // Cobertura por debajo de los días a cubrir: ámbar en la celda de días.
    wsPro.addConditionalFormatting({
      ref: `J2:J${ult}`,
      rules: [{
        type: 'expression', priority: 2,
        formulae: [`AND(ISNUMBER(J2),J2<${CELDA_DIAS})`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFE0B2' } } },
      }],
    })
  }

  // ── Conteos físicos (opcional) ─────────────────────────────────────────────
  let filasConteo = 0
  if (d.conteo && d.conteo.items.length > 0) {
    const porProd = new Map(prods.map(p => [p.id, p]))
    const wsFis = hojaDatos(wb, 'Conteos físicos', [
      { header: 'Ítem', key: 'item', width: 8, numFmt: '0' },
      { header: 'Producto', key: 'producto', width: 44 },
      { header: 'Presentación', key: 'presentacion', width: 18 },
      { header: 'Estado del conteo', key: 'estado', width: 14 },
      { header: `Contado (${d.conteo.periodo})`, key: 'contada', width: 14, numFmt: F_DEC },
      { header: 'Sistema al corte', key: 'sistema', width: 13, numFmt: F_DEC },
      { header: 'Diferencia (conteo − sistema)', key: 'dif', width: 14, numFmt: F_DEC },
      { header: 'Precio unitario', key: 'precio', width: 13, numFmt: F_COP },
      { header: 'Valor de la diferencia', key: 'v_dif', width: 16, numFmt: F_COP },
      { header: 'Stock real hoy', key: 'real_hoy', width: 12, numFmt: F_DEC },
      { header: 'Disponible hoy', key: 'disp_hoy', width: 12, numFmt: F_DEC },
    ])
    d.conteo.items.forEach((it, i) => {
      const r = i + 2
      const hoyP = it.productoId ? porProd.get(it.productoId) : undefined
      const dif = it.contada !== null && it.sistema !== null ? it.contada - it.sistema : null
      wsFis.addRow({
        item: it.codigo, producto: it.nombre, presentacion: it.presentacion, estado: it.estado,
        contada: it.contada, sistema: it.sistema,
        dif: dif === null ? null : { formula: `E${r}-F${r}`, result: dif },
        precio: it.precio || null,
        v_dif: dif === null ? null : { formula: `G${r}*H${r}`, result: dif * it.precio },
        real_hoy: hoyP?.real ?? null,
        disp_hoy: hoyP?.disponible ?? null,
      })
    })
    const ultF = d.conteo.items.length + 1
    const s = (f: (it: ItemConteo) => number) => d.conteo!.items.reduce((a, it) => a + f(it), 0)
    const difDe = (it: ItemConteo) => (it.contada !== null && it.sistema !== null ? it.contada - it.sistema : 0)
    filaTotales(wsFis, ultF + 1, ultF, [5, 6, 7, 9], {
      5: s(it => it.contada ?? 0), 6: s(it => it.sistema ?? 0), 7: s(difDe), 9: s(it => difDe(it) * it.precio),
    })
    rojoSiNegativo(wsFis, 'G', ultF, 11)
    const nota = wsFis.getCell(`A${ultF + 3}`)
    nota.value = `Inventario físico ${d.conteo.periodo} (corte ${d.conteo.fechaCorte}). Diferencia negativa = el conteo encontró menos de lo que decía el sistema.`
    nota.font = { size: 9, italic: true, color: { argb: GRIS } }
    filasConteo = d.conteo.items.length
  }

  // ── Estadísticas ───────────────────────────────────────────────────────────
  construirEstadisticas(wb, d, proy, ult)

  return { wb, filas: n * 3 + filasConteo, proyecciones: proy }
}

function construirEstadisticas(
  wb: ExcelJSNS.Workbook, d: DatosProyeccion, proy: Map<string, ResultadoProyeccion>, ult: number,
) {
  const ws = wb.addWorksheet(HOJA_EST, { views: [{ showGridLines: false }] })
  ws.columns = [
    { width: 44 }, { width: 18 }, { width: 44 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 },
  ]
  const prods = d.productos
  const inv = (col: string) => `Inventario!${col}2:${col}${ult}`
  const pro = (col: string) => `'Proyección'!${col}2:${col}${ult}`

  const seccion = (fila: number, texto: string) => {
    const c = ws.getCell(`A${fila}`)
    c.value = texto
    c.font = { bold: true, size: 12, color: { argb: VERDE_OSCURO } }
  }
  const encabezado = (fila: number, textos: string[]) => {
    const row = ws.getRow(fila)
    textos.forEach((t, i) => {
      const c = row.getCell(i + 1)
      c.value = t
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
      c.alignment = { vertical: 'middle', wrapText: true }
    })
    row.height = 30
  }

  ws.mergeCells('A1:H1')
  ws.getCell('A1').value = 'Inventario, consumo y proyección'
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: VERDE_OSCURO } }
  ws.mergeCells('A2:H2')
  ws.getCell('A2').value = `Generado el ${d.hoy.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })} — productos activos por ítem y nombre; "disponible" = stock real − reservado en pedidos sin despachar.`
  ws.getCell('A2').font = { size: 9, italic: true, color: { argb: GRIS } }

  // Parámetros (filas 4–9). B6 = días a cubrir: lo usan las fórmulas de Proyección.
  seccion(4, 'Parámetros')
  const param = (fila: number, label: string, valor: ExcelJSNS.CellValue, numFmt?: string) => {
    ws.getCell(`A${fila}`).value = label
    const c = ws.getCell(`B${fila}`)
    c.value = valor
    c.font = { bold: true }
    if (numFmt) c.numFmt = numFmt
  }
  param(5, 'Fecha de corte', fechaExcel(d.hoy), F_FECHA)
  param(6, 'Días a cubrir con la compra (puedes cambiarlo)', d.diasCompra, '0')
  ws.getCell('B6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARILLO } }
  ws.getCell('B6').border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  ws.getCell('C6').value = '← recalcula "Sugerido a comprar" y "Valor sugerido" de la hoja Proyección'
  ws.getCell('C6').font = { size: 9, italic: true, color: { argb: GRIS } }
  const conDatos = d.meses.filter(m => m.diasObservados >= 1)
  param(7, 'Meses analizados', `${d.meses[0].etiqueta} – ${d.meses[d.meses.length - 1].etiqueta}`)
  param(8, 'Consumo registrado desde', d.inicioDatos ? fechaExcel(d.inicioDatos) : fechaExcel(d.meses[0].inicio), F_FECHA)
  param(9, 'Días con datos / movimientos de consumo leídos',
    `${Math.round(conDatos.reduce((a, m) => a + m.diasObservados, 0))} días · ${d.movimientosLeidos.toLocaleString('es-CO')} movimientos`)

  // Resumen con fórmulas.
  seccion(11, 'Resumen')
  encabezado(12, ['Indicador', 'Valor'])
  const neg = prods.filter(p => p.disponible < 0)
  const x = (id: string) => proy.get(id) as ResultadoProyeccion
  const resumen: [string, string, number, string][] = [
    ['Productos activos', `COUNTA(${inv('B')})`, prods.length, F_ENTERO],
    ['Unidades en stock real', `SUM(${inv('F')})`, prods.reduce((a, p) => a + p.real, 0), F_DEC],
    ['Unidades reservadas (pedidos sin despachar)', `SUM(${inv('G')})`, prods.reduce((a, p) => a + p.reservado, 0), F_DEC],
    ['Unidades disponibles (real − reservado)', `SUM(${inv('H')})`, prods.reduce((a, p) => a + p.disponible, 0), F_DEC],
    ['Productos con déficit (disponible negativo)', `COUNTIF(${inv('H')},"<0")`, neg.length, F_ENTERO],
    ['Unidades en déficit (pedido de más)', `-SUMIF(${inv('H')},"<0")`, -neg.reduce((a, p) => a + p.disponible, 0), F_DEC],
    ['Valor del déficit', `-SUMIF(${inv('O')},"<0")`, -neg.reduce((a, p) => a + p.disponible * p.precio, 0), F_COP],
    ['Productos bajo el mínimo', `COUNTIF(${inv('J')},"<0")`, prods.filter(p => p.disponible - p.minimo < 0).length, F_ENTERO],
    ['Valor del stock real', `SUM(${inv('M')})`, prods.reduce((a, p) => a + p.real * p.precio, 0), F_COP],
    ['Valor reservado', `SUM(${inv('N')})`, prods.reduce((a, p) => a + p.reservado * p.precio, 0), F_COP],
    ['Valor disponible', `SUM(${inv('O')})`, prods.reduce((a, p) => a + p.disponible * p.precio, 0), F_COP],
    ['Consumo mensual promedio (unidades)', `SUM(${pro('F')})`, prods.reduce((a, p) => a + x(p.id).consumoMensual, 0), F_DEC],
    ['Productos sin consumo en el periodo', `COUNTIF(${pro('U')},"SIN CONSUMO")`, prods.filter(p => x(p.id).estado === 'SIN CONSUMO').length, F_ENTERO],
    ['Productos críticos (menos de 15 días de cobertura)', `COUNTIF(${pro('U')},"CRÍTICO")`, prods.filter(p => x(p.id).estado === 'CRÍTICO').length, F_ENTERO],
    ['Productos agotados con consumo', `COUNTIF(${pro('U')},"AGOTADO")`, prods.filter(p => x(p.id).estado === 'AGOTADO').length, F_ENTERO],
    ['Productos en negativo al cierre del 3.er mes (sin entradas)', `COUNTIF(${pro('T')},"<0")`, prods.filter(p => (x(p.id).stockProyectado[2] ?? 0) < 0).length, F_ENTERO],
    ['Unidades sugeridas a comprar', `SUM(${pro('O')})`, prods.reduce((a, p) => a + x(p.id).sugerido, 0), F_DEC],
    ['Valor sugerido a comprar', `SUM(${pro('Q')})`, prods.reduce((a, p) => a + x(p.id).sugerido * p.precio, 0), F_COP],
  ]
  let f = 13
  for (const [label, formula, result, fmt] of resumen) {
    ws.getCell(`A${f}`).value = label
    const c = ws.getCell(`B${f}`)
    c.value = { formula, result }
    c.numFmt = fmt
    c.font = { bold: true }
    ws.getRow(f).eachCell(cc => { cc.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } } })
    f++
  }

  // Distribución por categoría de rotación (fórmulas SUMIF/COUNTIF).
  f += 1
  seccion(f, 'Distribución por categoría de rotación'); f++
  encabezado(f, ['Categoría', 'Productos', 'Stock real', 'Reservado', 'Disponible', 'Valor stock real', 'Con déficit', 'Consumo mensual']); f++
  const cats = [...new Set(prods.map(p => p.cat || '(sin categoría)'))].sort()
  const iniCat = f
  for (const cat of cats) {
    const ps = prods.filter(p => (p.cat || '(sin categoría)') === cat)
    const crit = cat === '(sin categoría)' ? '""' : `"${cat}"`
    const row = ws.getRow(f)
    row.getCell(1).value = cat
    row.getCell(2).value = { formula: `COUNTIF(${inv('E')},${crit})`, result: ps.length }
    row.getCell(3).value = { formula: `SUMIF(${inv('E')},${crit},${inv('F')})`, result: ps.reduce((a, p) => a + p.real, 0) }
    row.getCell(4).value = { formula: `SUMIF(${inv('E')},${crit},${inv('G')})`, result: ps.reduce((a, p) => a + p.reservado, 0) }
    row.getCell(5).value = { formula: `SUMIF(${inv('E')},${crit},${inv('H')})`, result: ps.reduce((a, p) => a + p.disponible, 0) }
    row.getCell(6).value = { formula: `SUMIF(${inv('E')},${crit},${inv('M')})`, result: ps.reduce((a, p) => a + p.real * p.precio, 0) }
    row.getCell(7).value = { formula: `COUNTIFS(${inv('E')},${crit},${inv('H')},"<0")`, result: ps.filter(p => p.disponible < 0).length }
    row.getCell(8).value = { formula: `SUMIF(${pro('D')},${crit},${pro('F')})`, result: ps.reduce((a, p) => a + x(p.id).consumoMensual, 0) }
    ;[2, 7].forEach(c => { row.getCell(c).numFmt = F_ENTERO })
    ;[3, 4, 5, 8].forEach(c => { row.getCell(c).numFmt = F_DEC })
    row.getCell(6).numFmt = F_COP
    f++
  }
  const totRow = ws.getRow(f)
  totRow.getCell(1).value = 'TOTAL'
  for (let c = 2; c <= 8; c++) {
    const L = letra(c)
    let res = 0
    for (let r = iniCat; r < f; r++) {
      const v = ws.getCell(`${L}${r}`).value as { result?: number } | null
      res += num(v?.result)
    }
    totRow.getCell(c).value = { formula: `SUM(${L}${iniCat}:${L}${f - 1})`, result: res }
    totRow.getCell(c).numFmt = c === 6 ? F_COP : c === 2 || c === 7 ? F_ENTERO : F_DEC
  }
  totRow.font = { bold: true }
  f += 2

  // Top 20 déficit (ranking: del más negativo al menos negativo).
  seccion(f, 'Top 20 déficit (se pidió más de lo que hay) — ranking'); f++
  encabezado(f, ['Producto', 'Ítem', 'Presentación', 'Disponible', 'Reservado', 'Stock real', 'Valor del déficit', 'Días a cubrir']); f++
  const topDef = [...neg].sort((a, b) => a.disponible - b.disponible || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 20)
  if (topDef.length === 0) { ws.getCell(`A${f}`).value = '(sin productos en déficit)'; f++ }
  for (const p of topDef) {
    const row = ws.getRow(f)
    row.values = [p.nombre, p.codigo, p.presentacion, p.disponible, p.reservado, p.real, -p.disponible * p.precio]
    row.getCell(8).value = x(p.id).consumoDiario > 0 ? Math.round(-p.disponible / x(p.id).consumoDiario) : null
    row.getCell(2).numFmt = '0'
    ;[4, 5, 6].forEach(c => { row.getCell(c).numFmt = F_DEC })
    row.getCell(7).numFmt = F_COP
    row.getCell(8).numFmt = F_ENTERO
    row.getCell(4).font = { bold: true, color: { argb: ROJO } }
    f++
  }
  ws.getCell(`A${f}`).value = '"Días a cubrir" = días de consumo que representa el déficit.'
  ws.getCell(`A${f}`).font = { size: 9, italic: true, color: { argb: GRIS } }
  f += 2

  // Top 20 consumo.
  seccion(f, 'Top 20 consumo mensual — ranking'); f++
  encabezado(f, ['Producto', 'Ítem', 'Presentación', 'Consumo prom. mensual', 'Tendencia %', 'Disponible', 'Días de cobertura', 'Estado']); f++
  const topCon = [...prods].filter(p => x(p.id).consumoMensual > 0)
    .sort((a, b) => x(b.id).consumoMensual - x(a.id).consumoMensual || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 20)
  if (topCon.length === 0) { ws.getCell(`A${f}`).value = '(sin consumo registrado)'; f++ }
  for (const p of topCon) {
    const r = x(p.id)
    const row = ws.getRow(f)
    row.values = [p.nombre, p.codigo, p.presentacion, r.consumoMensual, r.tendenciaPct, p.disponible, r.diasCobertura === null ? null : Math.round(r.diasCobertura), r.estado]
    row.getCell(2).numFmt = '0'
    row.getCell(4).numFmt = F_DEC1
    row.getCell(5).numFmt = F_PCT
    row.getCell(6).numFmt = F_DEC
    row.getCell(7).numFmt = F_ENTERO
    if (p.disponible < 0) row.getCell(6).font = { bold: true, color: { argb: ROJO } }
    f++
  }
  f += 1

  // Cómo se calculó.
  seccion(f, 'Cómo se calculó'); f++
  const notas = [
    'Reservado = cantidad solicitada en órdenes de insumo que aún no salen de bodega (EN_REVISION, CAMBIOS_SOLICITADOS, APROBADA, PENDIENTE, EN_ALISTAMIENTO, ALISTADO). Es la vista v_stock_proyectado.',
    'Disponible real = stock real − reservado. Un disponible negativo (en rojo) significa que las sedes pidieron más de lo que hay en bodega.',
    'Consumo = salidas + traslados − devoluciones de cada mes. Las entradas y los ajustes no son consumo.',
    `Consumo promedio mensual = consumo neto del periodo ÷ días con datos × 30,4. Los meses con menos de 7 días de datos no se usan. Antes de ${d.inicioDatos ? fechaCorta(d.inicioDatos) : 'el inicio de la ventana'} el sistema no registraba consumos, así que esos días no cuentan como consumo cero.`,
    'Desviación estándar y coeficiente de variación: sobre la tasa mensual de cada mes con datos (mes en curso normalizado a 30,4 días). Un coeficiente alto = consumo irregular.',
    'Tendencia: pendiente de la regresión lineal simple de la tasa mensual (unidades/mes que sube o baja cada mes). Con 3 o más meses con datos la proyección usa esa recta; con menos, usa el promedio. El R² solo se informa con 3 o más meses.',
    'Días de cobertura = disponible ÷ consumo diario (0 si el disponible ya es cero o negativo). Fecha de agotamiento = fecha de corte + días de cobertura.',
    'Sugerido a comprar = máx(0, consumo diario × días a cubrir − disponible). Incluye reponer el déficit cuando el disponible es negativo. No descuenta órdenes de compra en camino.',
    'Stock fin de mes (sin entradas) = disponible − consumo proyectado acumulado de los próximos 3 meses.',
    'Las hojas de detalle van por ítem (código) y nombre; los "Top 20" de esta hoja son rankings.',
  ]
  for (const t of notas) {
    ws.mergeCells(`A${f}:H${f}`)
    const c = ws.getCell(`A${f}`)
    c.value = `• ${t}`
    c.font = { size: 9, color: { argb: GRIS } }
    c.alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(f).height = 26
    f++
  }
}

// ─── Descarga (navegador) ─────────────────────────────────────────────────────

export async function descargarReporteProyeccion(
  supabase: DB,
  opciones: OpcionesProyeccion,
  progreso: (paso: string) => void,
): Promise<number> {
  const datos = await cargarDatosProyeccion(supabase, opciones, progreso)
  progreso('Calculando la proyección y armando el Excel…')
  const ExcelJSMod = (await import('exceljs')).default
  const { wb, filas } = construirLibroProyeccion(ExcelJSMod, datos)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inventario_proyeccion_${datos.hoy.toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  return filas
}
