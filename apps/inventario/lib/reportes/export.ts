// Exportación a Excel de las tablas del sistema (el "diagrama de datos").
// Usa exceljs (ya dependencia) y el cliente de navegador de Supabase (respeta RLS).
import ExcelJS from 'exceljs'
import { traerTodo } from '@/lib/supabase/paginado'
import { ordenarAlfabetico, ordenarFilasPlanas, ordenarPorItem } from './orden'
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
  /**
   * Nombre principal para el orden alfabético cuando la tabla no es de
   * productos. Si se omite se deduce (nombre, razón social, número…).
   */
  ordenPor?: string
  /** Desempate: la columna de fecha va de la más reciente a la más antigua. */
  recientesPrimero?: boolean
}

/** Select con el producto embebido, para tablas con `producto_id`. */
const CON_PRODUCTO = '*, producto:productos ( nombre_estandar, ref, codigo )'

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
    { tabla: 'stock', hoja: 'Stock', select: CON_PRODUCTO, plano: conNombreProducto },
    { tabla: 'movimientos', hoja: 'Movimientos', select: CON_PRODUCTO, plano: conNombreProducto, recientesPrimero: true },
    { tabla: 'producto_fotos', hoja: 'Fotos producto', select: CON_PRODUCTO, plano: conNombreProducto },
  ]},
  { id: 'bodegas', nombre: 'Bodegas', tablas: [
    { tabla: 'bodegas', hoja: 'Bodegas' },
    { tabla: 'ubicaciones', hoja: 'Ubicaciones' },
  ]},
  { id: 'compras', nombre: 'Compras y proveedores', tablas: [
    { tabla: 'proveedores', hoja: 'Proveedores' },
    { tabla: 'precios_proveedor', hoja: 'Precios proveedor', select: CON_PRODUCTO, plano: conNombreProducto },
    { tabla: 'ordenes_compra', hoja: 'Órdenes compra', ordenPor: 'numero_oc' },
    { tabla: 'oc_items', hoja: 'OC items', select: CON_PRODUCTO, plano: conNombreProducto },
    { tabla: 'aprovisionamiento', hoja: 'Aprovisionamiento', select: CON_PRODUCTO, plano: conNombreProducto, recientesPrimero: true },
  ]},
  { id: 'operacion', nombre: 'Operación', tablas: [
    { tabla: 'grupos_contrato', hoja: 'Grupos contrato' },
    { tabla: 'sedes', hoja: 'Sedes' },
    { tabla: 'pedidos_sede', hoja: 'Pedidos sede', select: CON_PRODUCTO, plano: conNombreProducto, recientesPrimero: true },
    { tabla: 'rotacion', hoja: 'Rotación', select: CON_PRODUCTO, plano: conNombreProducto },
  ]},
  { id: 'arqueo', nombre: 'Arqueos', tablas: [
    { tabla: 'arqueos', hoja: 'Arqueos' },
    { tabla: 'arqueo_items', hoja: 'Arqueo items', select: CON_PRODUCTO, plano: conNombreProducto },
  ]},
  { id: 'usuarios', nombre: 'Usuarios y roles', tablas: [
    { tabla: 'usuarios', hoja: 'Usuarios' },
    { tabla: 'roles', hoja: 'Roles' },
  ]},
  { id: 'auditoria', nombre: 'Auditoría', tablas: [
    { tabla: 'actividad_log', hoja: 'Actividad', ordenPor: 'usuario_nombre', recientesPrimero: true },
    { tabla: 'historial_cambios', hoja: 'Historial cambios', ordenPor: 'tabla', recientesPrimero: true },
    { tabla: 'importaciones', hoja: 'Importaciones', ordenPor: 'entidad', recientesPrimero: true },
  ]},
  { id: 'otros', nombre: 'Otros', tablas: [
    { tabla: 'contactos_web', hoja: 'Contactos web' },
    { tabla: 'notificaciones', hoja: 'Notificaciones', ordenPor: 'titulo', recientesPrimero: true },
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
    // Paginado: PostgREST corta cada respuesta en 1.000 filas (`.limit()` no
    // levanta ese tope). `id` es la clave estable de todas estas tablas.
    let rows: Record<string, unknown>[]
    try {
      rows = await traerTodo<Record<string, unknown>>(
        (desde, hasta) => supabase.from(t.tabla).select(t.select ?? '*').order('id').range(desde, hasta),
        { maximo: MAX_FILAS },
      )
    } catch (e) {
      ws.addRow([`Error: ${e instanceof Error ? e.message : String(e)}`]); continue
    }
    if (t.plano) rows = rows.map(t.plano)
    if (rows.length === 0) { ws.addRow(['(sin datos)']); continue }
    rows = ordenarTabla(rows, t)

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

/**
 * Orden de cada hoja: por ítem (código) y nombre del producto si la tabla es de
 * productos; si no, alfabético por su nombre principal. `recientesPrimero`
 * desempata por fecha, de la más reciente a la más antigua.
 */
function ordenarTabla(rows: Record<string, unknown>[], t: TablaExport): Record<string, unknown>[] {
  let base = rows
  if (t.recientesPrimero && 'created_at' in rows[0]) {
    // ISO 8601: el orden de texto es el orden cronológico.
    base = [...rows].sort((a, b) => {
      const fa = String(a.created_at ?? ''), fb = String(b.created_at ?? '')
      return fa < fb ? 1 : fa > fb ? -1 : 0
    })
  }
  const r0 = base[0]
  if ('producto_codigo' in r0) return ordenarPorItem(base, r => r.producto_codigo, r => r.producto_nombre)
  if (t.tabla === 'productos') return ordenarPorItem(base, r => r.codigo, r => r.nombre_estandar)
  if (t.ordenPor && t.ordenPor in r0) return ordenarAlfabetico(base, r => r[t.ordenPor as string])
  if ('nombre' in r0) return ordenarAlfabetico(base, r => r.nombre)
  return ordenarFilasPlanas(base).filas
}

/** Exporta un conjunto arbitrario de filas (p.ej. actividad por usuario) a una hoja. */
export async function exportarFilas(filas: Record<string, unknown>[], hoja: string, filename: string) {
  filas = ordenarFilasPlanas(filas).filas
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
