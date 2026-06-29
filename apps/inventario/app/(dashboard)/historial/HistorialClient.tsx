'use client'
import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Pencil, Trash2, Search, History } from 'lucide-react'

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

export function HistorialClient({ cambios }: { cambios: CambioRow[] }) {
  const [tabla, setTabla] = useState('')
  const [accion, setAccion] = useState('')
  const [search, setSearch] = useState('')
  const [abierto, setAbierto] = useState<number | null>(null)

  const tablas = useMemo(() => Array.from(new Set(cambios.map(c => c.tabla))).sort(), [cambios])

  const filtrados = cambios.filter(c => {
    if (tabla && c.tabla !== tabla) return false
    if (accion && c.accion !== accion) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = `${c.usuario_email ?? ''} ${c.registro_id} ${(c.campos_cambiados ?? []).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap gap-3 shadow-sm items-center">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por usuario, campo o ID..."
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400" />
        </div>
        <select value={tabla} onChange={e => setTabla(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 bg-white outline-none">
          <option value="">Todas las tablas</option>
          {tablas.map(t => <option key={t} value={t}>{TABLA_LABEL[t] ?? t}</option>)}
        </select>
        <select value={accion} onChange={e => setAccion(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 bg-white outline-none">
          <option value="">Toda acción</option>
          <option value="INSERT">Creación</option>
          <option value="UPDATE">Edición</option>
          <option value="DELETE">Eliminación</option>
        </select>
      </div>

      {/* Lista */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {filtrados.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <History className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="font-body text-sm">No hay cambios que coincidan.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtrados.map(c => {
              const meta = ACCION_META[c.accion]
              const Icon = meta.icon
              const open = abierto === c.id
              const campos = c.campos_cambiados ?? []
              return (
                <div key={c.id}>
                  <button onClick={() => setAbierto(open ? null : c.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 text-left">
                    <ChevronRight className={`w-4 h-4 text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className={`inline-flex items-center gap-1 font-body text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.cls}`}>
                      <Icon className="w-3 h-3" /> {meta.label}
                    </span>
                    <span className="font-body text-sm text-gray-900 font-medium shrink-0">{TABLA_LABEL[c.tabla] ?? c.tabla}</span>
                    <span className="font-body text-xs text-gray-400 flex-1 truncate">
                      {c.accion === 'UPDATE' && campos.length > 0 ? `Cambió: ${campos.join(', ')}` : `ID ${c.registro_id.slice(0, 8)}`}
                    </span>
                    <span className="font-body text-xs text-gray-400 shrink-0 hidden sm:block">{c.usuario_email ?? 'sistema'}</span>
                    <span className="font-body text-xs text-gray-300 shrink-0">{new Date(c.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </button>

                  {open && (
                    <div className="px-12 pb-4 pt-1">
                      {c.accion === 'UPDATE' ? (
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
                              <tr key={k} className="border-t border-gray-50">
                                <td className="py-1.5 font-body font-medium text-xs text-gray-700">{k}</td>
                                <td className="py-1.5 font-mono text-xs text-red-600 max-w-[260px] truncate">{val(c.datos_anteriores?.[k])}</td>
                                <td className="py-1.5 font-mono text-xs text-green-700 max-w-[260px] truncate">{val(c.datos_nuevos?.[k])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-x-auto max-h-60">
                          {JSON.stringify(c.datos_nuevos ?? c.datos_anteriores, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <p className="font-body text-xs text-gray-400">Mostrando los últimos {cambios.length} cambios registrados automáticamente.</p>
    </div>
  )
}
