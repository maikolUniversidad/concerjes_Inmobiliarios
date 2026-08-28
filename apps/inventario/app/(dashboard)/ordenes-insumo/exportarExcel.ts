import type { OrdenRow } from './OrdenesInsumoClient'

// Generador del Excel de órdenes de insumo. Multi-hoja, con encabezados
// estilizados, autofiltro (filtrable en Excel) y anchos de columna.
// exceljs se importa dinámicamente para no cargar la librería hasta que se usa.

export interface ItemExport {
  orden_id: string
  codigo: string | number | null
  nombre: string
  presentacion: string | null
  es_adicional: boolean
  solicitado: number
  alistado: number
}

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador', EN_REVISION: 'En revisión', CAMBIOS_SOLICITADOS: 'Cambios solicitados',
  APROBADA: 'Aprobada', PENDIENTE: 'Pendiente', EN_ALISTAMIENTO: 'En alistamiento',
  ALISTADO: 'Alistado', DESPACHADO: 'Enviado', EN_RUTA: 'En ruta', ENTREGADO: 'Entregado',
  RECIBIDO: 'Recibido', ANULADA: 'Anulada',
}
const etiquetaEstado = (e: string) => ESTADO_LABEL[e] ?? e

function fechaCorta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function estilizarEncabezado(ws: any) {
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  header.alignment = { vertical: 'middle' }
  header.height = 20
  header.eachCell((cell: any) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1B5E20' } } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
}

export async function exportarOrdenesExcel(
  ordenes: OrdenRow[],
  items: ItemExport[],
  contexto: string,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios · Inventario'
  wb.created = new Date()

  const ordenPorId = new Map(ordenes.map((o) => [o.id, o]))

  // ── Hoja 1: Órdenes ────────────────────────────────────────────────────────
  const wsOrd = wb.addWorksheet('Órdenes', { views: [{ state: 'frozen', ySplit: 1 }] })
  wsOrd.columns = [
    { header: 'N.º orden', key: 'numero', width: 20 },
    { header: 'Estado', key: 'estado', width: 18 },
    { header: 'Sede', key: 'sede', width: 42 },
    { header: 'Creado por', key: 'creador', width: 26 },
    { header: 'Responsables', key: 'responsables', width: 13 },
    { header: 'Ítems', key: 'total', width: 9 },
    { header: 'Alistados', key: 'alistados', width: 11 },
    { header: '% avance', key: 'avance', width: 10 },
    { header: 'Urgente', key: 'urgente', width: 10 },
    { header: 'Creada', key: 'creada', width: 13 },
    { header: 'Entrega pactada', key: 'entrega', width: 16 },
    { header: 'Despachada', key: 'despachada', width: 13 },
    { header: 'Novedad del pedido', key: 'novedad', width: 46 },
    { header: 'Comentarios', key: 'comentarios', width: 12 },
    { header: 'Último comentario', key: 'ultimo', width: 46 },
  ]
  for (const o of ordenes) {
    wsOrd.addRow({
      numero: o.numero,
      estado: etiquetaEstado(o.estado),
      sede: o.sede,
      creador: o.creador_nombre ?? '',
      responsables: o.responsables,
      total: o.total_items,
      alistados: o.alistados,
      avance: o.total_items > 0 ? Math.round((o.alistados / o.total_items) * 100) / 100 : 0,
      urgente: o.urgente ? 'Sí' : 'No',
      creada: fechaCorta(o.created_at),
      entrega: fechaCorta(o.fecha_entrega_pactada),
      despachada: fechaCorta(o.despachado_at),
      novedad: o.observacion ?? '',
      comentarios: o.comentarios,
      ultimo: o.ultimo_comentario
        ? `${o.comentario_autor ? `${o.comentario_autor}: ` : ''}${o.ultimo_comentario}`
        : '',
    })
  }
  wsOrd.getColumn('avance').numFmt = '0%'
  estilizarEncabezado(wsOrd)

  // ── Hoja 2: Ítems (detalle por producto de cada orden) ─────────────────────
  const wsItems = wb.addWorksheet('Ítems', { views: [{ state: 'frozen', ySplit: 1 }] })
  wsItems.columns = [
    { header: 'N.º orden', key: 'numero', width: 20 },
    { header: 'Estado orden', key: 'estado', width: 18 },
    { header: 'Sede', key: 'sede', width: 42 },
    { header: 'Código', key: 'codigo', width: 12 },
    { header: 'Producto', key: 'producto', width: 48 },
    { header: 'Presentación', key: 'presentacion', width: 20 },
    { header: 'Tipo', key: 'tipo', width: 16 },
    { header: 'Solicitado', key: 'solicitado', width: 12 },
    { header: 'Alistado', key: 'alistado', width: 11 },
  ]
  for (const it of items) {
    const o = ordenPorId.get(it.orden_id)
    wsItems.addRow({
      numero: o?.numero ?? '',
      estado: o ? etiquetaEstado(o.estado) : '',
      sede: o?.sede ?? '',
      codigo: it.codigo ?? '',
      producto: it.nombre,
      presentacion: it.presentacion ?? '',
      tipo: it.es_adicional ? 'Adicional' : 'Parametrizado',
      solicitado: it.solicitado,
      alistado: it.alistado,
    })
  }
  estilizarEncabezado(wsItems)

  // ── Hoja 3: Resumen (por estado y por creador) ─────────────────────────────
  const wsRes = wb.addWorksheet('Resumen')
  const porEstado = new Map<string, number>()
  const porCreador = new Map<string, number>()
  for (const o of ordenes) {
    porEstado.set(o.estado, (porEstado.get(o.estado) ?? 0) + 1)
    const c = o.creador_nombre ?? 'Sin usuario'
    porCreador.set(c, (porCreador.get(c) ?? 0) + 1)
  }
  wsRes.addRow([`Reporte generado — ${contexto}`])
  wsRes.getRow(1).font = { bold: true, size: 12 }
  wsRes.addRow([`Total de órdenes: ${ordenes.length}`])
  wsRes.addRow([])
  wsRes.addRow(['POR ESTADO', 'Órdenes'])
  wsRes.getRow(4).font = { bold: true }
  const ordenEstados = Object.keys(ESTADO_LABEL)
  ;[...porEstado.entries()]
    .sort((a, b) => ordenEstados.indexOf(a[0]) - ordenEstados.indexOf(b[0]))
    .forEach(([e, n]) => wsRes.addRow([etiquetaEstado(e), n]))
  wsRes.addRow([])
  const rIdx = wsRes.rowCount + 1
  wsRes.addRow(['POR CREADOR', 'Órdenes'])
  wsRes.getRow(rIdx).font = { bold: true }
  ;[...porCreador.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => wsRes.addRow([c, n]))
  wsRes.getColumn(1).width = 34
  wsRes.getColumn(2).width = 12

  // ── Descargar ──────────────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const fecha = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `ordenes-insumo_${fecha}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
