import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Package, Check, X, Pencil, Database } from 'lucide-react'
import { encolar } from '@conserjes/offline'
import { db, store } from '../lib/db'
import { EVENTO_SYNC } from '../components/Layout'
import { usePermisos } from '../components/Permisos'

interface Prod {
  id: string
  ref: number | null
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: string
  precio_lista: number | null
  stock_minimo_def: number
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const CAT: Record<string, string> = { A: 'bg-green-100 text-green-700', B: 'bg-blue-100 text-blue-700', C: 'bg-amber-100 text-amber-700', D: 'bg-gray-100 text-gray-500' }

export function Productos() {
  const { tiene } = usePermisos()
  const puedeEditar = tiene('editar_productos')
  const [prods, setProds] = useState<Prod[]>([])
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const [p, s] = await Promise.all([
      db.table('productos').toArray() as Promise<Prod[]>,
      db.table('stock').toArray() as Promise<{ producto_id: string; cantidad_real: number }[]>,
    ])
    setProds(p.filter(x => (x as unknown as { activo?: boolean }).activo !== false).sort((a, b) => a.nombre_estandar.localeCompare(b.nombre_estandar)))
    setStockMap(Object.fromEntries(s.map(x => [x.producto_id, Number(x.cantidad_real)])))
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    const h = () => cargar()
    window.addEventListener(EVENTO_SYNC, h)
    return () => window.removeEventListener(EVENTO_SYNC, h)
  }, [cargar])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return prods.slice(0, 200)
    return prods.filter(p => p.nombre_estandar.toLowerCase().includes(t) || String(p.ref ?? '').includes(t)).slice(0, 200)
  }, [prods, q])

  async function guardarPrecio(p: Prod) {
    const nuevo = Number(editVal)
    setEditId(null)
    if (!Number.isFinite(nuevo) || nuevo < 0) return
    // Escritura optimista local + encolar para sincronizar
    await store.bulkPut('productos', [{ ...p, precio_lista: nuevo } as unknown as Record<string, unknown> & { id: string }])
    await encolar(store, 'update:productos', { id: p.id, precio_lista: nuevo })
    cargar()
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5 sticky top-0 z-10 shadow-sm">
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o REF…"
          className="flex-1 text-sm outline-none" />
      </div>

      {cargando ? (
        <p className="text-center text-sm text-gray-400 py-10">Cargando…</p>
      ) : prods.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Database className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-bold text-gray-600">No hay datos locales aún</p>
          <p className="text-sm mt-1">Pulsa el botón de sincronizar (↻) con conexión para descargar el inventario.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400">{filtrados.length} de {prods.length} productos · disponibles sin conexión</p>
          <div className="space-y-2">
            {filtrados.map(p => {
              const real = stockMap[p.id] ?? 0
              const critico = p.stock_minimo_def > 0 && real <= p.stock_minimo_def
              return (
                <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-gray-400" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-gray-400">{p.ref ?? '—'}</span>
                        <span className={`text-[11px] font-bold px-1.5 rounded ${CAT[p.cat_rotacion] ?? 'bg-gray-100'}`}>{p.cat_rotacion}</span>
                      </div>
                      <p className="font-medium text-sm text-gray-900 leading-tight">{p.nombre_estandar}</p>
                      <p className="text-xs text-gray-400">{p.presentacion}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-bold text-base ${critico ? 'text-red-600' : 'text-gray-900'}`}>{real}</p>
                      <p className="text-[11px] text-gray-400">en stock</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                    {editId === p.id ? (
                      <div className="flex items-center gap-1.5 flex-1">
                        <input autoFocus type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                          className="w-28 border border-brand-green rounded-lg px-2 py-1 text-sm outline-none" placeholder="Precio" />
                        <button onClick={() => guardarPrecio(p)} className="p-1.5 bg-brand-green text-white rounded-lg"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-gray-600">{p.precio_lista ? cop.format(p.precio_lista) : 'Sin precio'}</span>
                        {puedeEditar && (
                          <button onClick={() => { setEditId(p.id); setEditVal(p.precio_lista ? String(p.precio_lista) : '') }}
                            className="flex items-center gap-1 text-xs text-brand-green font-semibold">
                            <Pencil className="w-3.5 h-3.5" /> Editar precio
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
