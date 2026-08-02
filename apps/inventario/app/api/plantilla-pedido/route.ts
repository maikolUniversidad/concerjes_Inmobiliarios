import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
  // 1. Sedes seleccionadas (o todas las activas)
  let sedesQ = supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre')
  if (sedeIds.length > 0) sedesQ = sedesQ.in('id', sedeIds)
  const { data: sedesData } = await sedesQ

  // 2. Productos activos
  const { data: productosData } = await supabase
    .from('productos')
    .select('id, nombre_estandar, presentacion, complemento, cat_rotacion')
    .eq('activo', true)
    .order('nombre_estandar')

  // 3. Parametrización sede_productos (cantidades máximas)
  const sedeIdsUsados = (sedesData ?? []).map((s: { id: string }) => s.id)
  const { data: paramData } = await supabase
    .from('sede_productos')
    .select('sede_id, producto_id, cantidad_maxima')
    .in('sede_id', sedeIdsUsados)
    .eq('activo', true)

  // 4. Stock actual
  const { data: stockData } = await supabase
    .from('stock')
    .select('producto_id, cantidad')

  // 5. Usuario actual
  const { data: usuarioData } = await supabase
    .from('usuarios')
    .select('nombre')
    .eq('id', user.id)
    .single()

  // ── Estructuras de datos ───────────────────────────────────────────────────
  const sedes = (sedesData ?? []) as { id: string; nombre: string }[]
  const productos = (productosData ?? []) as {
    id: string; nombre_estandar: string; presentacion: string | null;
    complemento: string | null; cat_rotacion: string
  }[]

  // Mapa param: "sede_id|producto_id" → cantidad_maxima
  const paramMap = new Map<string, number>()
  for (const p of (paramData ?? []) as { sede_id: string; producto_id: string; cantidad_maxima: number }[]) {
    paramMap.set(`${p.sede_id}|${p.producto_id}`, p.cantidad_maxima ?? 0)
  }

  // Mapa stock: producto_id → cantidad
  const stockMap = new Map<string, number>()
  for (const s of (stockData ?? []) as { producto_id: string; cantidad: number }[]) {
    const prev = stockMap.get(s.producto_id) ?? 0
    stockMap.set(s.producto_id, prev + (s.cantidad ?? 0))
  }

  // Solo productos que tienen parametrización en al menos una sede (o todos si no hay param)
  const productosFiltrados = paramData && paramData.length > 0
    ? productos.filter(p => sedes.some(s => paramMap.has(`${s.id}|${p.id}`)))
    : productos

  // ── Generar Excel ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios'
  wb.created = new Date()

  // ╔══════════════════════════════════════════════════════════╗
  // ║  HOJA 1 — Mensual (plantilla operativa)                 ║
  // ╚══════════════════════════════════════════════════════════╝
  const ws = wb.addWorksheet('Mensual')

  const COL_FIXED = 6          // A..F fijas (FAV, ITEM, NOMBRE, PRESENTACION, COMPLEMENTO, CAT)
  const totalCols  = COL_FIXED + sedes.length + 1  // +1 TOTAL

  // Anchos de columnas
  ws.getColumn(1).width = 5    // FAV
  ws.getColumn(2).width = 6    // ITEM
  ws.getColumn(3).width = 40   // NOMBRE ESTANDAR
  ws.getColumn(4).width = 22   // PRESENTACION
  ws.getColumn(5).width = 20   // COMPLEMENTO
  ws.getColumn(6).width = 6    // CAT
  for (let i = 0; i < sedes.length; i++) {
    ws.getColumn(COL_FIXED + 1 + i).width = Math.max(12, Math.min(22, sedes[i].nombre.length * 0.7 + 2))
  }
  ws.getColumn(totalCols).width = 10  // TOTAL

  // ── Fila 1: Título ──────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols)
  const tituloCell = ws.getCell(1, 1)
  tituloCell.value = 'SOLICITUD MENSUAL DE INSUMOS'
  tituloCell.font  = { bold: true, size: 14, color: { argb: COL_TITULO_FG } }
  tituloCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_TITULO_BG } }
  tituloCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26

  // ── Fila 2: vacía ───────────────────────────────────────────
  ws.getRow(2).height = 8

  // ── Fila 3: SOLICITANTE / FECHA ──────────────────────────────
  ws.getRow(3).height = 20
  const mesEntrega = new Date(); mesEntrega.setMonth(mesEntrega.getMonth() + 1)
  const mesLabel = mesEntrega.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase()

  function metaLabel(row: number, col: number, label: string) {
    const c = ws.getCell(row, col)
    c.value = label
    c.font  = { bold: true, size: 10 }
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_META_BG } }
    c.alignment = { vertical: 'middle' }
    c.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } } }
  }
  function metaInput(row: number, col: number, value: string) {
    const c = ws.getCell(row, col)
    c.value = value
    c.font  = { size: 10 }
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_INPUT_BG } }
    c.alignment = { vertical: 'middle' }
    c.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } } }
  }

  metaLabel(3, 1, 'SOLICITANTE')
  ws.mergeCells(3, 2, 3, 4)
  metaInput(3, 2, (usuarioData as { nombre?: string } | null)?.nombre ?? '')
  metaLabel(3, 5, 'FECHA DE SOLICITUD')
  ws.mergeCells(3, 6, 3, totalCols)
  metaInput(3, 6, new Date().toLocaleDateString('es-CO'))

  // ── Fila 4: NOTA / MES ENTREGA ────────────────────────────────
  ws.getRow(4).height = 20
  metaLabel(4, 1, 'NOTA OPCIONAL')
  ws.mergeCells(4, 2, 4, 4)
  metaInput(4, 2, '')
  metaLabel(4, 5, 'MES DE ENTREGA')
  ws.mergeCells(4, 6, 4, totalCols)
  metaInput(4, 6, mesLabel)

  // ── Fila 5: vacía (podría llevar códigos de sede) ─────────────
  ws.getRow(5).height = 6

  // ── Fila 6: Encabezados de columnas ──────────────────────────
  ws.getRow(6).height = 40
  const hdrs = ['★', 'ITEM', 'NOMBRE ESTÁNDAR', 'PRESENTACIÓN', 'COMPLEMENTO', 'CAT.', ...sedes.map(s => s.nombre), 'TOTAL']
  hdrs.forEach((h, i) => {
    const c = ws.getCell(6, i + 1)
    c.value = h
    c.font  = { bold: true, size: 9, color: { argb: i < COL_FIXED ? COL_HEADER_FG : (i === hdrs.length - 1 ? 'FF1F4E79' : COL_HEADER_FG) } }
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < COL_FIXED ? COL_HEADER_BG : (i === hdrs.length - 1 ? COL_TOTAL_BG : COL_SEDE_BG) } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.border = {
      top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      bottom: { style: 'medium', color: { argb: 'FF2E7D32' } },
      left:  { style: 'thin', color: { argb: 'FFB0C4DE' } },
      right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
    }
    // Columnas de sede: texto en verde oscuro
    if (i >= COL_FIXED && i < hdrs.length - 1) {
      c.font = { bold: true, size: 8, color: { argb: COL_HEADER_FG } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_HEADER_BG } }
    }
  })

  // ── Filas 7+: Productos ───────────────────────────────────────
  productosFiltrados.forEach((prod, idx) => {
    const rowNum = 7 + idx
    const row = ws.getRow(rowNum)
    row.height = 16

    // Columnas fijas
    ws.getCell(rowNum, 1).value = ''   // FAV
    ws.getCell(rowNum, 2).value = idx + 1
    ws.getCell(rowNum, 3).value = prod.nombre_estandar
    ws.getCell(rowNum, 4).value = prod.presentacion ?? ''
    ws.getCell(rowNum, 5).value = prod.complemento ?? ''

    const catCell = ws.getCell(rowNum, 6)
    catCell.value = prod.cat_rotacion
    catCell.font  = { bold: true, color: { argb: COL_CAT_FONTS[prod.cat_rotacion] ?? 'FF4D4D4D' } }

    // Columnas de sedes
    const sedeColStart = COL_FIXED + 1
    sedes.forEach((sede, si) => {
      const col = sedeColStart + si
      const qty = paramMap.get(`${sede.id}|${prod.id}`) ?? null
      const c = ws.getCell(rowNum, col)
      c.value = qty && qty > 0 ? qty : null
      c.alignment = { horizontal: 'center' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
      c.border = {
        top:    { style: 'hair', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'hair', color: { argb: 'FFD0D0D0' } },
        left:   { style: 'hair', color: { argb: 'FFD0D0D0' } },
        right:  { style: 'hair', color: { argb: 'FFD0D0D0' } },
      }
    })

    // Columna TOTAL: fórmula SUM
    const startLetter = colNumToLetter(sedeColStart)
    const endLetter   = colNumToLetter(sedeColStart + sedes.length - 1)
    const totalCell = ws.getCell(rowNum, totalCols)
    totalCell.value  = sedes.length > 0
      ? { formula: `SUM(${startLetter}${rowNum}:${endLetter}${rowNum})` }
      : 0
    totalCell.font   = { bold: true, color: { argb: '00000066' } }
    totalCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_TOTAL_BG } }
    totalCell.alignment = { horizontal: 'center' }
    totalCell.border = {
      left:  { style: 'thin', color: { argb: 'FFB0C4DE' } },
      right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      top:   { style: 'hair', color: { argb: 'FFD0D0D0' } },
      bottom:{ style: 'hair', color: { argb: 'FFD0D0D0' } },
    }

    // Zebra
    if (idx % 2 === 1) {
      for (let col = 1; col <= COL_FIXED; col++) {
        const c = ws.getCell(rowNum, col)
        if (!c.fill || (c.fill as ExcelJS.FillPattern).fgColor?.argb === 'FFFFFFFF') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }
        }
      }
    }

    // Estilos fijos izquierda
    ws.getCell(rowNum, 2).alignment = { horizontal: 'center' }
    ws.getCell(rowNum, 3).font = { size: 9 }
    ws.getCell(rowNum, 4).font = { size: 9, color: { argb: 'FF444444' } }
  })

  // Auto filter desde fila 6
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: totalCols } }

  // Fijar columnas fijas (freeze pane)
  ws.views = [{ state: 'frozen', xSplit: COL_FIXED, ySplit: 6 }]

  // ╔══════════════════════════════════════════════════════════╗
  // ║  HOJA 2 — Productos (catálogo con stock actual)         ║
  // ╚══════════════════════════════════════════════════════════╝
  const wsProd = wb.addWorksheet('Productos')
  wsProd.columns = [
    { header: 'ITEM',            key: 'item',         width: 6  },
    { header: 'NOMBRE ESTÁNDAR', key: 'nombre',       width: 45 },
    { header: 'PRESENTACIÓN',    key: 'presentacion', width: 22 },
    { header: 'COMPLEMENTO',     key: 'complemento',  width: 20 },
    { header: 'CAT',             key: 'cat',          width: 6  },
    { header: 'STOCK ACTUAL',    key: 'stock',        width: 14 },
  ]
  const hdr2 = wsProd.getRow(1)
  hdr2.height = 22
  hdr2.font   = { bold: true, color: { argb: COL_TITULO_FG } }
  hdr2.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_HEADER_BG } }
  hdr2.alignment = { vertical: 'middle', horizontal: 'center' }
  hdr2.eachCell(c => { c.border = { bottom: { style: 'medium', color: { argb: 'FF1B5E20' } } } })

  productos.forEach((p, i) => {
    const stock = stockMap.get(p.id) ?? 0
    const r = wsProd.addRow({
      item:         i + 1,
      nombre:       p.nombre_estandar,
      presentacion: p.presentacion ?? '',
      complemento:  p.complemento ?? '',
      cat:          p.cat_rotacion,
      stock,
    })
    r.height = 16
    if (i % 2 === 1) {
      r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } } })
    }
    const catC = r.getCell('cat')
    catC.font = { bold: true, color: { argb: COL_CAT_FONTS[p.cat_rotacion] ?? 'FF4D4D4D' } }
    const stockC = r.getCell('stock')
    stockC.alignment = { horizontal: 'center' }
    if (stock <= 0) stockC.font = { color: { argb: 'FFCC0000' } }
  })

  wsProd.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } }
  wsProd.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]

  // ── Serializar y devolver ──────────────────────────────────────
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
