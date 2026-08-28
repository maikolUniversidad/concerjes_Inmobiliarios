import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import ExcelJS from 'exceljs'

// Paleta visual igual a los Excel originales
const COL_TITULO_BG = 'FF1F4E79'   // azul oscuro
const COL_TITULO_FG = 'FFFFFFFF'
const COL_HEADER_BG = 'FF2E7D32'   // verde
const COL_HEADER_FG = 'FFFFFFFF'
const COL_META_BG   = 'FFDCE6F1'   // azul pálido (filas SOLICITANTE, MES)
const COL_SEDE_BG   = 'FFEAF4EA'   // verde pálido (cabeceras de sedes)
const COL_INPUT_BG  = 'FFFFFFCC'   // amarillo claro (celdas editables)
const COL_TOTAL_BG  = 'FFD9E1F2'   // azul pálido (columna TOTAL)
const COL_CAT_FONTS: Record<string, string> = {
  A: 'FF1F4E79', B: 'FF375623', C: 'FF833C00', D: 'FF4D4D4D',
}

interface Sede { id: string; nombre: string; grupo: string | null }
interface Producto {
  id: string; nombre_estandar: string; presentacion: string | null
  complemento: string | null; cat_rotacion: string
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  // ── Autenticación ──────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('No autorizado', { status: 401 })

  // ── Parámetros ─────────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const sedesParam = url.searchParams.get('sedes')   // IDs separados por coma
  const sedeIds = sedesParam ? sedesParam.split(',').filter(Boolean) : []

  // ── Consultas a BD ─────────────────────────────────────────────────────────
  // 1. Sedes seleccionadas (o todas las activas), con su grupo/contrato.
  const sedesData = await traerTodo((desde, hasta) => {
    let q = supabase.from('sedes').select('id, nombre, grupo:grupos_contrato ( nombre )')
      .eq('activo', true).order('nombre').order('id')
    if (sedeIds.length > 0) q = q.in('id', sedeIds)
    return q.range(desde, hasta)
  })

  // 2. Productos activos (paginado: la plantilla necesita el catálogo COMPLETO
  //    y PostgREST devuelve máximo 1.000 filas por respuesta)
  const productosData = await traerTodo((desde, hasta) => supabase
    .from('productos')
    .select('id, nombre_estandar, presentacion, complemento, cat_rotacion')
    .eq('activo', true)
    .order('nombre_estandar').order('id')
    .range(desde, hasta))

  // 3. Parametrización sede_productos (cantidades máximas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedeIdsUsados = ((sedesData ?? []) as any[]).map(s => s.id)
  // Paginado: es una matriz sedes × productos, hoy ya pasa de 800 filas.
  const paramData = await traerTodo((desde, hasta) => supabase
    .from('sede_productos')
    .select('sede_id, producto_id, cantidad_maxima')
    .in('sede_id', sedeIdsUsados)
    .eq('activo', true)
    .order('id')
    .range(desde, hasta))

  // 4. Stock actual
  const stockData = await traerTodo((desde, hasta) => supabase
    .from('stock')
    .select('producto_id, cantidad_real')
    .order('producto_id')
    .range(desde, hasta))

  // 5. Usuario actual
  const { data: usuarioData } = await supabase
    .from('usuarios')
    .select('nombre')
    .eq('id', user.id)
    .single()

  // ── Estructuras de datos ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedes: Sede[] = ((sedesData ?? []) as any[]).map(s => ({ id: s.id, nombre: s.nombre, grupo: s.grupo?.nombre ?? null }))
  const productos = (productosData ?? []) as Producto[]

  // Mapa param: "sede_id|producto_id" → cantidad_maxima
  const paramMap = new Map<string, number>()
  for (const p of (paramData ?? []) as { sede_id: string; producto_id: string; cantidad_maxima: number }[]) {
    paramMap.set(`${p.sede_id}|${p.producto_id}`, p.cantidad_maxima ?? 0)
  }
  const hayParam = !!paramData && paramData.length > 0

  // Mapa stock: producto_id → cantidad
  const stockMap = new Map<string, number>()
  for (const s of stockData as { producto_id: string; cantidad_real: number }[]) {
    stockMap.set(s.producto_id, (stockMap.get(s.producto_id) ?? 0) + (Number(s.cantidad_real) || 0))
  }

  const solicitante = (usuarioData as { nombre?: string } | null)?.nombre ?? ''
  const mesEntrega = new Date(); mesEntrega.setMonth(mesEntrega.getMonth() + 1)
  const mesLabel = mesEntrega.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase()

  /** Productos con parametrización en al menos una de las sedes dadas (o todos si no hay param). */
  const productosPara = (ss: Sede[]): Producto[] =>
    hayParam ? productos.filter(p => ss.some(s => paramMap.has(`${s.id}|${p.id}`))) : productos

  // ── Generar Excel ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios'
  wb.created = new Date()

  /**
   * Construye una hoja tipo matriz: productos (filas) × sedes (columnas) con las
   * cantidades máximas parametrizadas y una columna TOTAL. Se usa para la hoja
   * general (todas las sedes) y para una hoja por contrato (solo sus sedes).
   */
  function poblarHoja(ws: ExcelJS.Worksheet, sedesHoja: Sede[], titulo: string) {
    const prods = productosPara(sedesHoja)
    const COL_FIXED = 6                                   // A..F fijas
    const totalCols = COL_FIXED + sedesHoja.length + 1    // +1 TOTAL

    // Anchos
    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 6
    ws.getColumn(3).width = 40
    ws.getColumn(4).width = 22
    ws.getColumn(5).width = 20
    ws.getColumn(6).width = 6
    for (let i = 0; i < sedesHoja.length; i++) {
      ws.getColumn(COL_FIXED + 1 + i).width = Math.max(12, Math.min(22, sedesHoja[i].nombre.length * 0.7 + 2))
    }
    ws.getColumn(totalCols).width = 10

    // Fila 1: Título
    ws.mergeCells(1, 1, 1, totalCols)
    const tituloCell = ws.getCell(1, 1)
    tituloCell.value = titulo
    tituloCell.font  = { bold: true, size: 14, color: { argb: COL_TITULO_FG } }
    tituloCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_TITULO_BG } }
    tituloCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 26
    ws.getRow(2).height = 8

    // Fila 3-4: meta
    const metaLabel = (row: number, col: number, label: string) => {
      const c = ws.getCell(row, col)
      c.value = label; c.font = { bold: true, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_META_BG } }
      c.alignment = { vertical: 'middle' }
      c.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } } }
    }
    const metaInput = (row: number, col: number, value: string) => {
      const c = ws.getCell(row, col)
      c.value = value; c.font = { size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_INPUT_BG } }
      c.alignment = { vertical: 'middle' }
      c.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } } }
    }
    ws.getRow(3).height = 20
    metaLabel(3, 1, 'SOLICITANTE'); ws.mergeCells(3, 2, 3, 4); metaInput(3, 2, solicitante)
    metaLabel(3, 5, 'FECHA DE SOLICITUD'); ws.mergeCells(3, 6, 3, totalCols); metaInput(3, 6, new Date().toLocaleDateString('es-CO'))
    ws.getRow(4).height = 20
    metaLabel(4, 1, 'NOTA OPCIONAL'); ws.mergeCells(4, 2, 4, 4); metaInput(4, 2, '')
    metaLabel(4, 5, 'MES DE ENTREGA'); ws.mergeCells(4, 6, 4, totalCols); metaInput(4, 6, mesLabel)
    ws.getRow(5).height = 6

    // Fila 6: encabezados
    ws.getRow(6).height = 40
    const hdrs = ['★', 'ITEM', 'NOMBRE ESTÁNDAR', 'PRESENTACIÓN', 'COMPLEMENTO', 'CAT.', ...sedesHoja.map(s => s.nombre), 'TOTAL']
    hdrs.forEach((h, i) => {
      const c = ws.getCell(6, i + 1)
      c.value = h
      c.font = { bold: true, size: 9, color: { argb: i < COL_FIXED ? COL_HEADER_FG : (i === hdrs.length - 1 ? 'FF1F4E79' : COL_HEADER_FG) } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < COL_FIXED ? COL_HEADER_BG : (i === hdrs.length - 1 ? COL_TOTAL_BG : COL_SEDE_BG) } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      c.border = {
        top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        bottom: { style: 'medium', color: { argb: 'FF2E7D32' } },
        left: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      }
      if (i >= COL_FIXED && i < hdrs.length - 1) {
        c.font = { bold: true, size: 8, color: { argb: COL_HEADER_FG } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_HEADER_BG } }
      }
    })

    // Filas 7+: productos
    prods.forEach((prod, idx) => {
      const rowNum = 7 + idx
      const row = ws.getRow(rowNum); row.height = 16
      ws.getCell(rowNum, 1).value = ''
      ws.getCell(rowNum, 2).value = idx + 1
      ws.getCell(rowNum, 3).value = prod.nombre_estandar
      ws.getCell(rowNum, 4).value = prod.presentacion ?? ''
      ws.getCell(rowNum, 5).value = prod.complemento ?? ''
      const catCell = ws.getCell(rowNum, 6)
      catCell.value = prod.cat_rotacion
      catCell.font = { bold: true, color: { argb: COL_CAT_FONTS[prod.cat_rotacion] ?? 'FF4D4D4D' } }

      const sedeColStart = COL_FIXED + 1
      sedesHoja.forEach((sede, si) => {
        const col = sedeColStart + si
        const qty = paramMap.get(`${sede.id}|${prod.id}`) ?? null
        const c = ws.getCell(rowNum, col)
        c.value = qty && qty > 0 ? qty : null
        c.alignment = { horizontal: 'center' }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
        c.border = {
          top: { style: 'hair', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'hair', color: { argb: 'FFD0D0D0' } },
          left: { style: 'hair', color: { argb: 'FFD0D0D0' } }, right: { style: 'hair', color: { argb: 'FFD0D0D0' } },
        }
      })

      const startLetter = colNumToLetter(sedeColStart)
      const endLetter = colNumToLetter(sedeColStart + sedesHoja.length - 1)
      const totalCell = ws.getCell(rowNum, totalCols)
      totalCell.value = sedesHoja.length > 0 ? { formula: `SUM(${startLetter}${rowNum}:${endLetter}${rowNum})` } : 0
      totalCell.font = { bold: true, color: { argb: '00000066' } }
      totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_TOTAL_BG } }
      totalCell.alignment = { horizontal: 'center' }
      totalCell.border = {
        left: { style: 'thin', color: { argb: 'FFB0C4DE' } }, right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
        top: { style: 'hair', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'hair', color: { argb: 'FFD0D0D0' } },
      }

      if (idx % 2 === 1) {
        for (let col = 1; col <= COL_FIXED; col++) {
          const c = ws.getCell(rowNum, col)
          if (!c.fill || (c.fill as ExcelJS.FillPattern).fgColor?.argb === 'FFFFFFFF') {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }
          }
        }
      }
      ws.getCell(rowNum, 2).alignment = { horizontal: 'center' }
      ws.getCell(rowNum, 3).font = { size: 9 }
      ws.getCell(rowNum, 4).font = { size: 9, color: { argb: 'FF444444' } }
    })

    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: totalCols } }
    ws.views = [{ state: 'frozen', xSplit: COL_FIXED, ySplit: 6 }]
  }

  // ── Hoja 1: TODAS las sedes juntas ───────────────────────────────────────────
  poblarHoja(wb.addWorksheet('Todos'), sedes, 'SOLICITUD MENSUAL DE INSUMOS — TODOS LOS CONTRATOS')

  // ── Una hoja por contrato (grupo) con solo sus sedes ─────────────────────────
  const porContrato = new Map<string, Sede[]>()
  for (const s of sedes) {
    const clave = s.grupo ?? 'Sin contrato'
    const arr = porContrato.get(clave)
    if (arr) arr.push(s); else porContrato.set(clave, [s])
  }
  const usados = new Set<string>(['todos', 'productos'])
  // Solo tiene sentido separar por contrato si hay más de uno.
  if (porContrato.size > 1) {
    for (const [contrato, ss] of porContrato) {
      const nombreHoja = nombreUnico(contrato, usados)
      poblarHoja(wb.addWorksheet(nombreHoja), ss, `SOLICITUD MENSUAL — ${contrato.toUpperCase()}`)
    }
  }

  // ── Última hoja: catálogo de productos con stock ─────────────────────────────
  const wsProd = wb.addWorksheet('Productos')
  wsProd.columns = [
    { header: 'ITEM', key: 'item', width: 6 },
    { header: 'NOMBRE ESTÁNDAR', key: 'nombre', width: 45 },
    { header: 'PRESENTACIÓN', key: 'presentacion', width: 22 },
    { header: 'COMPLEMENTO', key: 'complemento', width: 20 },
    { header: 'CAT', key: 'cat', width: 6 },
    { header: 'STOCK ACTUAL', key: 'stock', width: 14 },
  ]
  const hdr2 = wsProd.getRow(1)
  hdr2.height = 22
  hdr2.font = { bold: true, color: { argb: COL_TITULO_FG } }
  hdr2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_HEADER_BG } }
  hdr2.alignment = { vertical: 'middle', horizontal: 'center' }
  hdr2.eachCell(c => { c.border = { bottom: { style: 'medium', color: { argb: 'FF1B5E20' } } } })
  productos.forEach((p, i) => {
    const stock = stockMap.get(p.id) ?? 0
    const r = wsProd.addRow({ item: i + 1, nombre: p.nombre_estandar, presentacion: p.presentacion ?? '', complemento: p.complemento ?? '', cat: p.cat_rotacion, stock })
    r.height = 16
    if (i % 2 === 1) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } } })
    r.getCell('cat').font = { bold: true, color: { argb: COL_CAT_FONTS[p.cat_rotacion] ?? 'FF4D4D4D' } }
    const stockC = r.getCell('stock'); stockC.alignment = { horizontal: 'center' }
    if (stock <= 0) stockC.font = { color: { argb: 'FFCC0000' } }
  })
  wsProd.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } }
  wsProd.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]

  // ── Serializar y devolver ────────────────────────────────────────────────────
  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  const fecha = new Date().toISOString().slice(0, 10)
  const filename = `plantilla_pedido_${fecha}.xlsx`
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Convierte número de columna (1-based) a letra Excel: 1→A, 27→AA */
function colNumToLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Nombre de hoja válido (Excel: máx 31, sin : \ / ? * [ ]) y único en el libro. */
function nombreUnico(base: string, usados: Set<string>): string {
  const limpio = (base || 'Contrato').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Contrato'
  let nombre = limpio
  let i = 2
  while (usados.has(nombre.toLowerCase())) {
    const sufijo = ` (${i++})`
    nombre = limpio.slice(0, 31 - sufijo.length) + sufijo
  }
  usados.add(nombre.toLowerCase())
  return nombre
}
