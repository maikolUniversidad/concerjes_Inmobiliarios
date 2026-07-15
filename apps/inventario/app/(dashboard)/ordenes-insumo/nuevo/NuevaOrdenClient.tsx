'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Package, MapPin, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { crearOrdenInsumo } from '../actions'

export interface SedeOpt { id: string; nombre: string; grupo: string | null }
export interface BodegaOpt { id: string; nombre: string }
export interface UsuarioOpt { id: string; nombre: string }

interface ItemForm {
  producto_id: string
  nombre: string
  presentacion: string | null
  maximo: number
  cantidad: number
  /** true = pedido fuera de la parametrización de la sede (sin tope). */
  es_adicional: boolean
}

interface ProdOpt { id: string; nombre: string; presentacion: string | null }

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'

// El responsable queda asignado automáticamente a quien crea la orden.
export function NuevaOrdenClient({ sedes, bodegas }: { sedes: SedeOpt[]; bodegas: BodegaOpt[]; usuarios?: UsuarioOpt[] }) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [sedeId, setSedeId] = useState('')
  const [bodegaId, setBodegaId] = useState('')
  const [observacion, setObservacion] = useState('')
  const [items, setItems] = useState<ItemForm[]>([])
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Catálogo completo para agregar productos fuera de la parametrización.
  const [catalogo, setCatalogo] = useState<ProdOpt[]>([])
  const [buscar, setBuscar] = useState('')

  /** Búsqueda inteligente: filtra mientras se escribe (sin tildes, multi-palabra). */
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const sugerencias = (() => {
    const q = norm(buscar.trim())
    const libres = catalogo.filter((p) => !items.some((i) => i.producto_id === p.id))
    if (!q) return libres.slice(0, 8)
    const tokens = q.split(/\s+/)
    return libres
      .filter((p) => {
        const hay = norm(`${p.nombre} ${p.presentacion ?? ''}`)
        return tokens.every((t) => hay.includes(t))
      })
      .slice(0, 8)
  })()

  /** Agrega un producto que NO está parametrizado: sin tope, marcado como adicional. */
  function agregarAdicional(p: ProdOpt) {
    if (items.some((i) => i.producto_id === p.id)) { toast.info('Ese producto ya está en la orden.'); return }
    setItems((prev) => [...prev, {
      producto_id: p.id, nombre: p.nombre, presentacion: p.presentacion,
      maximo: 0, cantidad: 1, es_adicional: true,
    }])
    setBuscar('')
  }

  function quitarItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function onSede(id: string) {
    setSedeId(id)
    setItems([])
    setError(null)
    if (!id) return
    setCargando(true)
    try {
      const [{ data }, { data: prods }] = await Promise.all([
        sb.from('sede_productos')
          .select('cantidad_maxima, producto:productos ( id, nombre_estandar, presentacion )')
          .eq('sede_id', id).eq('activo', true),
        sb.from('productos').select('id, nombre_estandar, presentacion').eq('activo', true).order('nombre_estandar'),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = ((data ?? []) as any[])
        .filter((r) => r.producto)
        .map((r) => ({
          producto_id: r.producto.id,
          nombre: r.producto.nombre_estandar,
          presentacion: r.producto.presentacion ?? null,
          maximo: Number(r.cantidad_maxima) || 0,
          cantidad: Number(r.cantidad_maxima) || 0,
          es_adicional: false,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
      setItems(rows)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCatalogo(((prods ?? []) as any[]).map((p) => ({ id: p.id, nombre: p.nombre_estandar, presentacion: p.presentacion ?? null })))
      // No es bloqueante: siempre se pueden agregar productos adicionales.
      if (rows.length === 0) setError('Esta sede no tiene productos parametrizados. Puedes agregar los que necesites como adicionales.')
    } finally {
      setCargando(false)
    }
  }

  function setCantidad(i: number, v: number) {
    // Los parametrizados topan en su máximo; los adicionales no tienen tope.
    setItems((prev) => prev.map((it, idx) => {
      if (idx !== i) return it
      const tope = it.es_adicional || !it.maximo ? Infinity : it.maximo
      return { ...it, cantidad: Math.max(0, Math.min(tope, v)) }
    }))
  }

  async function guardar() {
    setError(null)
    const conCantidad = items.filter((it) => it.cantidad > 0)
    if (!sedeId) { setError('Selecciona una sede.'); return }
    if (conCantidad.length === 0) { setError('Ingresa cantidad en al menos un producto.'); return }
    setGuardando(true)
    try {
      const res = await crearOrdenInsumo({
        sede_id: sedeId,
        bodega_id: bodegaId || null,
        observacion: observacion || null,
        items: conCantidad.map((it) => ({
          producto_id: it.producto_id, cantidad: it.cantidad, maximo: it.maximo, es_adicional: it.es_adicional,
        })),
      })
      // crearOrdenInsumo redirige en éxito; si volvió, hubo error.
      if (res?.error) { setError(res.error); return }
    } catch (e) {
      // redirect() lanza NEXT_REDIRECT: es el flujo normal de éxito.
      if (e && typeof e === 'object' && 'digest' in e && String((e as { digest?: string }).digest).includes('NEXT_REDIRECT')) {
        toast.success('Orden creada.')
        throw e
      }
      setError(e instanceof Error ? e.message : 'No se pudo crear la orden.')
    } finally {
      setGuardando(false)
    }
  }

  const total = items.filter((i) => i.cantidad > 0).length

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2 font-body text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Sede + bodega */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm grid sm:grid-cols-2 gap-3">
        <div>
          <label className="font-body font-semibold text-xs text-gray-600 block mb-1 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-brand-green" /> Sede (cliente) <span className="text-red-500">*</span>
          </label>
          <select value={sedeId} onChange={(e) => onSede(e.target.value)} className={inputCls}>
            <option value="">— Selecciona una sede —</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.grupo ? ` · ${s.grupo}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Bodega de origen</label>
          <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className={inputCls}>
            <option value="">— Opcional —</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </div>
      </div>

      {/* Productos parametrizados */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-brand-green" /> Productos {items.length > 0 && `(${items.length})`}
          </p>
          {cargando && <Loader2 className="w-4 h-4 animate-spin text-brand-green" />}
        </div>
        {items.length === 0 ? (
          <p className="font-body text-sm text-gray-400 text-center py-10">
            {sedeId ? (cargando ? 'Cargando parametrización…' : 'Sin productos parametrizados.') : 'Selecciona una sede para cargar sus productos.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Producto</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-32">Origen</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-24">Máximo</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-28">Cantidad</th>
                  <th className="px-3 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((it, i) => (
                  <tr key={it.producto_id} className={`hover:bg-gray-50/60 ${it.es_adicional ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2">
                      <p className="font-body text-sm text-gray-900 truncate max-w-[260px]">{it.nombre}</p>
                      {it.presentacion && <p className="font-body text-[11px] text-gray-400">{it.presentacion}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {it.es_adicional ? (
                        <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          <AlertCircle className="w-3 h-3" /> Adicional
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                          Parametrizado
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-body text-sm text-gray-500">
                      {it.es_adicional ? <span className="text-gray-300">sin tope</span> : it.maximo}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} max={it.es_adicional ? undefined : (it.maximo || undefined)} step="1" value={it.cantidad}
                        onChange={(e) => setCantidad(i, Number(e.target.value) || 0)}
                        className={`${inputCls} text-center font-semibold`} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {it.es_adicional && (
                        <button type="button" onClick={() => quitarItem(i)} title="Quitar"
                          className="text-gray-300 hover:text-red-500 transition-colors">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Agregar producto fuera de la parametrización (no restrictivo) */}
        {sedeId && (
          <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60">
            <p className="font-body text-xs text-gray-500 mb-2">
              ¿Falta algo? Agrega productos <strong>adicionales</strong> aunque no estén parametrizados para esta sede — sin tope.
              La central los revisa al aprobar.
            </p>
            {/* Buscador inteligente: filtra al escribir; clic en el resultado lo agrega */}
            <div className="relative">
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Escribe para buscar un producto del catálogo…"
                className={inputCls}
              />
              {buscar.trim() !== '' && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {sugerencias.length === 0 ? (
                    <p className="px-3 py-3 font-body text-sm text-gray-400">Sin resultados para “{buscar}”.</p>
                  ) : (
                    sugerencias.map((p) => (
                      <button
                        key={p.id} type="button" onClick={() => agregarAdicional(p)}
                        className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-gray-50 last:border-0"
                      >
                        <span className="font-body text-sm text-gray-800">{p.nombre}</span>
                        {p.presentacion && <span className="font-body text-xs text-gray-400"> · {p.presentacion}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Observación */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Observación</label>
        <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2}
          className={`${inputCls} resize-none`} placeholder="Notas del pedido (opcional)" />
      </div>

      <div className="flex items-center justify-end gap-3">
        <button onClick={() => router.push('/ordenes-insumo')} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
        <button onClick={guardar} disabled={guardando || total === 0}
          className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Crear orden ({total})
        </button>
      </div>
    </div>
  )
}
