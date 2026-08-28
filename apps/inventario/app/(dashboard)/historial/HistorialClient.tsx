'use client'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, History } from 'lucide-react'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

export interface CambioRow {
  id: number
  tabla: string
  registro_id: string
  accion: 'INSERT' | 'UPDATE' | 'DELETE'
  datos_anteriores: Record<string, unknown> | null
  datos_nuevos: Record<string, unknown> | null
  campos_cambiados: string[] | null
  usuario_email: string | null
  origen: string | null
  created_at: string
}

const ACCION_META: Record<string, { label: string; cls: string; icon: typeof Plus }> = {
  INSERT: { label: 'Creación', cls: 'bg-green-100 text-green-700', icon: Plus },
  UPDATE: { label: 'Edición', cls: 'bg-blue-100 text-blue-700', icon: Pencil },
  DELETE: { label: 'Eliminación', cls: 'bg-red-100 text-red-700', icon: Trash2 },
}

const TABLA_LABEL: Record<string, string> = {
  productos: 'Productos', usuarios: 'Usuarios', proveedores: 'Proveedores', sedes: 'Sedes',
  stock: 'Stock', ordenes_compra: 'Órdenes de compra', oc_items: 'Ítems de OC',
  grupos_contrato: 'Grupos', precios_proveedor: 'Precios',
}

function val(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Diferencias del cambio: tabla campo/antes/después o el JSON del registro. */
function DetalleCambio({ c }: { c: CambioRow }) {
  const campos = c.campos_cambiados ?? []
  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-body text-xs text-gray-400 hover:text-gray-600">
        <ChevronRight className="inline w-3.5 h-3.5 group-open:hidden" />
        <ChevronDown className="hidden w-3.5 h-3.5 group-open:inline" />
        Ver
      </summary>
      <div className="mt-1 max-w-[420px] overflow-x-auto rounded-lg border border-gray-100 bg-gray-50 p-2">
        {c.accion === 'UPDATE' && campos.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left font-body font-semibold text-xs uppercase py-1">Campo</th>
                <th className="text-left font-body font-semibold text-xs uppercase py-1">Antes</th>
                <th className="text-left font-body font-semibold text-xs uppercase py-1">Después</th>
              </tr>
            </thead>
            <tbody>
              {campos.map(k => (
                <tr key={k} className="border-t border-gray-100">
                  <td className="py-1.5 font-body font-medium text-xs text-gray-700">{k}</td>
                  <td className="py-1.5 font-mono text-xs text-red-600 max-w-[160px] truncate">{val(c.datos_anteriores?.[k])}</td>
                  <td className="py-1.5 font-mono text-xs text-green-700 max-w-[160px] truncate">{val(c.datos_nuevos?.[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="max-h-60 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-gray-600">
            {JSON.stringify(c.datos_nuevos ?? c.datos_anteriores, null, 2)}
          </pre>
        )}
      </div>
    </details>
  )
}

export function HistorialClient({ cambios }: { cambios: CambioRow[] }) {
  const [tabla, setTabla] = useState('')
  const [accion, setAccion] = useState('')

  const tablas = useMemo(() => Array.from(new Set(cambios.map(c => c.tabla))).sort(), [cambios])

  const filtrados = useMemo(() => cambios.filter(c => {
    if (tabla && c.tabla !== tabla) return false
    if (accion && c.accion !== accion) return false
    return true
  }), [cambios, tabla, accion])

  const columnas: ColumnaTabla<CambioRow>[] = [
    {
      id: 'accion', header: 'Acción', valor: c => ACCION_META[c.accion]?.label ?? c.accion, tarjeta: 'badge',
      celda: c => {
        const meta = ACCION_META[c.accion]
        const Icon = meta.icon
        return (
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-body text-xs font-medium ${meta.cls}`}>
            <Icon className="w-3 h-3" /> {meta.label}
          </span>
        )
      },
    },
    {
      id: 'tabla', header: 'Tabla', valor: c => TABLA_LABEL[c.tabla] ?? c.tabla, tarjeta: 'titulo',
      className: 'font-medium text-gray-900',
    },
    {
      id: 'cambio', header: 'Cambio', tarjeta: 'cuerpo', ancho: 'min-w-[220px]', className: 'text-xs text-gray-500',
      valor: c => {
        const campos = c.campos_cambiados ?? []
        return c.accion === 'UPDATE' && campos.length > 0
          ? `Cambió: ${campos.join(', ')}`
          : `ID ${c.registro_id.slice(0, 8)}`
      },
    },
    { id: 'registro', header: 'Registro', valor: c => c.registro_id, prioridad: 3, className: 'font-mono text-[11px] text-gray-400', tarjeta: 'oculto' },
    { id: 'usuario', header: 'Usuario', valor: c => c.usuario_email ?? 'sistema', prioridad: 2, className: 'text-xs text-gray-500', tarjeta: 'meta' },
    { id: 'origen', header: 'Origen', valor: c => c.origen ?? '', prioridad: 3, className: 'text-xs text-gray-400', tarjeta: 'oculto' },
    {
      id: 'fecha', header: 'Fecha', prioridad: 2, align: 'right', tarjeta: 'meta',
      className: 'whitespace-nowrap text-xs text-gray-400',
      valor: c => new Date(c.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
    },
    {
      id: 'detalle', header: 'Detalle', copiable: false, filtrable: false, interactiva: true, tarjeta: 'oculto',
      valor: () => '', celda: c => <DetalleCambio c={c} />,
    },
  ]

  return (
    <div className="space-y-4">
      <TablaEstandar
        id="historial"
        titulo="Historial de cambios"
        modulo="Sistema"
        entidad="historial_cambios"
        datos={filtrados}
        columnas={columnas}
        filaId={c => String(c.id)}
        busqueda="Buscar por usuario, campo o ID…"
        vacio={
          <>
            <History className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="font-body text-sm text-gray-400">No hay cambios que coincidan.</p>
          </>
        }
        herramientas={
          <>
            <select value={tabla} onChange={e => setTabla(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 font-body text-sm text-gray-700 bg-white outline-none">
              <option value="">Todas las tablas</option>
              {tablas.map(t => <option key={t} value={t}>{TABLA_LABEL[t] ?? t}</option>)}
            </select>
            <select value={accion} onChange={e => setAccion(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 font-body text-sm text-gray-700 bg-white outline-none">
              <option value="">Toda acción</option>
              <option value="INSERT">Creación</option>
              <option value="UPDATE">Edición</option>
              <option value="DELETE">Eliminación</option>
            </select>
          </>
        }
      />
      <p className="font-body text-xs text-gray-400">Mostrando los últimos {cambios.length} cambios registrados automáticamente.</p>
    </div>
  )
}
