// Exportación a Excel de las tablas del sistema (el "diagrama de datos").
// Usa exceljs (ya dependencia) y el cliente de navegador de Supabase (respeta RLS).
import ExcelJS from 'exceljs'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const VERDE = 'FF2E7D32'
const MAX_FILAS = 10000

export interface TablaExport {
  tabla: string
  hoja: string
  /** Select personalizado (p. ej. con join a productos). Por defecto '*'. */
  select?: string
  /** Aplana/reordena cada fila (p. ej. incrusta el nombre del producto). */
  plano?: (row: Record<string, unknown>) => Record<string, unknown>
}

// Aplana una fila de inventario incrustando el nombre/código del producto justo
// después de producto_id, para que el Excel sea legible sin cruzar hojas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conNombreProducto(r: Record<string, any>): Record<string, unknown> {
  const p = r.producto ?? {}
  const { producto: _omit, id, producto_id, ...resto } = r
  return {
    id,
    producto_id,
    producto_nombre: p.nombre_estandar ?? null,
    producto_ref: p.ref ?? null,
    producto_codigo: p.codigo ?? null,
    ...resto,
  }
}

export interface GrupoExport { id: string; nombre: string; tablas: TablaExport[] }

// Catálogo de exportación por dominio (cubre todo el modelo de datos)
export const GRUPOS_EXPORT: GrupoExport[] = [
  { id: 'inventario', nombre: 'Inventario', tablas: [
    { tabla: 'productos', hoja: 'Productos' },
    { tabla: 'stock', hoja: 'Stock',
      select: '*, producto:productos ( nombre_estandar, ref, codigo )', plano: conNombreProducto },
    { tabla: 'movimientos', hoja: 'Movimientos',
      select: '*, producto:productos ( nombre_estandar, ref, codigo )', plano: conNombreProducto },
    { tabla: 'producto_fotos', hoja: 'Fotos producto' },
  ]},
  { id: 'bodegas', nombre: 'Bodegas', tablas: [
    { tabla: 'bodegas', hoja: 'Bodegas' },
    { tabla: 'ubicaciones', hoja: 'Ubicaciones' },
  ]},
  { id: 'compras', nombre: 'Compras y proveedores', tablas: [
    { tabla: 'proveedores', hoja: 'Proveedores' },
    { tabla: 'precios_proveedor', hoja: 'Precios proveedor' },
    { tabla: 'ordenes_compra', hoja: 'Órdenes compra' },
    { tabla: 'oc_items', hoja: 'OC items' },
    { tabla: 'aprovisionamiento', hoja: 'Aprovisionamiento' },
  ]},
  { id: 'operacion', nombre: 'Operación', tablas: [
    { tabla: 'grupos_contrato', hoja: 'Grupos contrato' },
    { tabla: 'sedes', hoja: 'Sedes' },
    { tabla: 'pedidos_sede', hoja: 'Pedidos sede' },
    { tabla: 'rotacion', hoja: 'Rotación' },
  ]},
  { id: 'arqueo', nombre: 'Arqueos', tablas: [
    { tabla: 'arqueos', hoja: 'Arqueos' },
    { tabla: 'arqueo_items', hoja: 'Arqueo items' },
  ]},
  { id: 'usuarios', nombre: 'Usuarios y roles', tablas: [
    { tabla: 'usuarios', hoja: 'Usuarios' },
    { tabla: 'roles', hoja: 'Roles' },
  ]},
  { id: 'auditoria', nombre: 'Auditoría', tablas: [
    { tabla: 'actividad_log', hoja: 'Actividad' },
    { tabla: 'historial_cambios', hoja: 'Historial cambios' },
    { tabla: 'importaciones', hoja: 'Importaciones' },
  ]},
  { id: 'otros', nombre: 'Otros', tablas: [
    { tabla: 'contactos_web', hoja: 'Contactos web' },
    { tabla: 'notificaciones', hoja: 'Notificaciones' },
    { tabla: 'reglas_alerta', hoja: 'Reglas alerta' },
  ]},
]

export const TODAS_LAS_TABLAS: TablaExport[] = GRUPOS_EXPORT.flatMap(g => g.tablas)

function celda(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  return String(v)
}

/** Construye y descarga un .xlsx con una hoja por tabla. */
export async function exportarExcel(
  supabase: DB,
  tablas: TablaExport[],
  filename: string,
  onProgress?: (hoja: string, i: number, total: number) => void,
): Promise<{ filas: number; error?: string }> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios'
  let totalFilas = 0

  for (let i = 0; i < tablas.length; i++) {
    const t = tablas[i]
    onProgress?.(t.hoja, i + 1, tablas.length)
    const ws = wb.addWorksheet(t.hoja.slice(0, 31))
    const { data, error } = await supabase.from(t.tabla).select(t.select ?? '*').limit(MAX_FILAS)
    if (error) { ws.addRow([`Error: ${error.message}`]); continue }
    let rows = (data ?? []) as Record<string, unknown>[]
    if (t.plano) rows = rows.map(t.plano)
    if (rows.length === 0) { ws.addRow(['(sin datos)']); continue }

    const cols = Object.keys(rows[0])
    ws.columns = cols.map(k => ({ header: k, key: k, width: Math.min(40, Math.max(12, k.length + 4)) }))
    const header = ws.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    header.alignment = { vertical: 'middle' }
    for (const r of rows) {
      const flat: Record<string, ReturnType<typeof celda>> = {}
      for (const k of cols) flat[k] = celda(r[k])
      ws.addRow(flat)
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
    totalFilas += rows.length
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
  return { filas: totalFilas }
}

/** Exporta un conjunto arbitrario de filas (p.ej. actividad por usuario) a una hoja. */
export async function exportarFilas(filas: Record<string, unknown>[], hoja: string, filename: string) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(hoja.slice(0, 31))
  if (filas.length === 0) { ws.addRow(['(sin datos)']) }
  else {
    const cols = Object.keys(filas[0])
    ws.columns = cols.map(k => ({ header: k, key: k, width: Math.min(40, Math.max(12, k.length + 4)) }))
    const header = ws.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    filas.forEach(f => ws.addRow(f))
  }
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
