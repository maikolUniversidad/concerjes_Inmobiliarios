'use client'

import { useMemo, useState } from 'react'
import {
  Search, Plus, Trash2, MapPin, Package, SlidersHorizontal, Copy, Loader2, X, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'

export interface SedeOpt {
  id: string
  nombre: string
  zona: string | null
  codigo_interno: string | null
  grupo_codigo: string | null
  grupo_nombre: string | null
}

export interface ProductoOpt {
  id: string
  ref: number | null
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  tipo_insumo: string | null
}

export interface ParamRow {
  id: string
  sede_id: string
  producto_id: string
  cantidad_maxima: number
  cantidad_minima: number | null
  activo: boolean
  observacion: string | null
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-2 py-1.5 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'

export function ParametrizacionClient({
  sedes, productos, params: initParams, puedeGestionar,
}: {
  sedes: SedeOpt[]
  productos: ProductoOpt[]
  params: ParamRow[]
  puedeGestionar: boolean
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [rows, setRows] = useState<ParamRow[]>(initParams)
  const [selId, setSelId] = useState<string | null>(sedes[0]?.id ?? null)
  const [buscaSede, setBuscaSede] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [copiando, setCopiando] = useState(false)
  const [copyFrom, setCopyFrom] = useState('')

  const prodById = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const countBySede = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.sede_id, (m.get(r.sede_id) ?? 0) + 1)
    return m
  }, [rows])

  const sede = sedes.find((s) => s.id === selId) ?? null

  const sedesFiltradas = useMemo(() => {
    const q = buscaSede.trim().toLowerCase()
    if (!q) return sedes
    return sedes.filter((s) =>
      s.nombre.toLowerCase().includes(q) ||
      (s.codigo_interno ?? '').toLowerCase().includes(q) ||
      (s.grupo_nombre ?? '').toLowerCase().includes(q))
  }, [sedes, buscaSede])

  const rowsSede = useMemo(
    () => rows.filter((r) => r.sede_id === selId)
      .map((r) => ({ ...r, prod: prodById.get(r.producto_id) }))
      .sort((a, b) => (a.prod?.nombre_estandar ?? '').localeCompare(b.prod?.nombre_estandar ?? '')),
    [rows, selId, prodById],
  )

  const idsEnSede = useMemo(() => new Set(rowsSede.map((r) => r.producto_id)), [rowsSede])

  const prodDisponibles = useMemo(() => {
    const q = buscaProd.trim().toLowerCase()
    if (!q) return []
    return productos
      .filter((p) => !idsEnSede.has(p.id))
      .filter((p) =>
        p.nombre_estandar.toLowerCase().includes(q) ||
        String(p.ref ?? '').includes(q) ||
        String(p.codigo ?? '').includes(q))
      .slice(0, 8)
  }, [productos, idsEnSede, buscaProd])

  async function agregar(prod: ProductoOpt) {
    if (!selId) return
    const payload = { sede_id: selId, producto_id: prod.id, cantidad_maxima: 0, cantidad_minima: 0, activo: true }
    const { data, error } = await sb.from('sede_productos').insert(payload).select('id, sede_id, producto_id, cantidad_maxima, cantidad_minima, activo, observacion').single()
    if (error || !data) {
      toast.error(/row-level security|permission/i.test(error?.message ?? '') ? 'Sin permisos para gestionar parametrización.' : 'No se pudo agregar el producto.')
      return
    }
    setRows((prev) => [...prev, data as ParamRow])
    setBuscaProd('')
    await logActivity(sb, { accion: 'CREAR', modulo: 'Parametrización', descripcion: `Producto agregado a sede: ${prod.nombre_estandar}`, entidad: 'sede_productos', entidad_id: data.id })
  }

  async function actualizar(id: string, patch: Partial<ParamRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    const { error } = await sb.from('sede_productos').update(patch).eq('id', id)
    if (error) toast.error('No se pudo guardar el cambio.')
  }

  async function eliminar(id: string) {
    const prev = rows
    setRows((p) => p.filter((r) => r.id !== id))
    const { error } = await sb.from('sede_productos').delete().eq('id', id)
    if (error) { setRows(prev); toast.error('No se pudo eliminar.') }
  }

  async function copiarDesde() {
    if (!selId || !copyFrom || copyFrom === selId) return
    setCopiando(true)
    try {
      const origen = rows.filter((r) => r.sede_id === copyFrom && !idsEnSede.has(r.producto_id))
      if (origen.length === 0) { toast.info('No hay productos nuevos que copiar.'); return }
      const payload = origen.map((r) => ({
        sede_id: selId, producto_id: r.producto_id,
        cantidad_maxima: r.cantidad_maxima, cantidad_minima: r.cantidad_minima ?? 0, activo: true,
      }))
      const { data, error } = await sb.from('sede_productos').insert(payload).select('id, sede_id, producto_id, cantidad_maxima, cantidad_minima, activo, observacion')
      if (error || !data) { toast.error('No se pudo copiar la parametrización.'); return }
      setRows((prev) => [...prev, ...(data as ParamRow[])])
      setCopyFrom('')
      toast.success(`${data.length} producto(s) copiados.`)
    } finally {
      setCopiando(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 sm:gap-5">

      {/* ── Sedes ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm min-w-0">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 mb-3 focus-within:border-brand-green">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={buscaSede} onChange={(e) => setBuscaSede(e.target.value)} placeholder="Buscar sede..."
            className="flex-1 min-w-0 font-body text-sm outline-none placeholder:text-gray-400" />
        </div>
        <div className="space-y-1 max-h-[70vh] overflow-y-auto">
          {sedesFiltradas.length === 0 && <p className="font-body text-xs text-gray-400 text-center py-4">Sin sedes</p>}
          {sedesFiltradas.map((s) => {
            const n = countBySede.get(s.id) ?? 0
            const active = s.id === selId
            return (
              <button key={s.id} onClick={() => setSelId(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${active ? 'bg-green-50 border border-brand-green' : 'hover:bg-gray-50 border border-transparent'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-body text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-brand-green shrink-0" /> {s.nombre}
                  </p>
                  <span className={`shrink-0 font-body text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${n > 0 ? 'bg-brand-green/10 text-brand-green' : 'bg-gray-100 text-gray-400'}`}>{n}</span>
                </div>
                <p className="font-body text-xs text-gray-400 truncate ml-5">
                  {s.grupo_nombre ?? 'Sin grupo'}{s.codigo_interno ? ` · ${s.codigo_interno}` : ''}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Detalle de sede ── */}
      <div className="min-w-0 space-y-4">
        {!sede ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center shadow-sm">
            <SlidersHorizontal className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="font-body text-sm text-gray-400">Selecciona una sede para parametrizar sus productos.</p>
          </div>
        ) : (
          <>
            {/* Header sede */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="font-heading font-bold text-lg text-gray-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-brand-green" /> {sede.nombre}
                  </h2>
                  <p className="font-body text-sm text-gray-500 mt-0.5">
                    {sede.grupo_nombre ?? 'Sin grupo'} · {rowsSede.length} producto(s) parametrizado(s)
                  </p>
                </div>
                {puedeGestionar && sedes.length > 1 && (
                  <div className="flex items-center gap-2">
                    <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 font-body text-xs outline-none focus:border-brand-green bg-white max-w-[160px]">
                      <option value="">Copiar desde…</option>
                      {sedes.filter((s) => s.id !== selId).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                    <button onClick={copiarDesde} disabled={!copyFrom || copiando}
                      className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 font-body text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
                      {copiando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />} Copiar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Agregar producto */}
            {puedeGestionar && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm relative">
                <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-2">Agregar producto a la sede</p>
                <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 focus-within:border-brand-green">
                  <Plus className="w-4 h-4 text-gray-400 shrink-0" />
                  <input value={buscaProd} onChange={(e) => setBuscaProd(e.target.value)} placeholder="Buscar producto por nombre, REF o código..."
                    className="flex-1 min-w-0 font-body text-sm outline-none placeholder:text-gray-400" />
                  {buscaProd && <button onClick={() => setBuscaProd('')}><X className="w-4 h-4 text-gray-400" /></button>}
                </div>
                {buscaProd && (
                  <div className="absolute left-4 right-4 z-10 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    {prodDisponibles.length === 0 && <p className="font-body text-xs text-gray-400 px-3 py-3">Sin coincidencias nuevas</p>}
                    {prodDisponibles.map((p) => (
                      <button key={p.id} onClick={() => agregar(p)}
                        className="w-full text-left px-3 py-2 hover:bg-green-50 transition-colors flex items-center gap-2">
                        <Package className="w-4 h-4 text-brand-green shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-body text-sm text-gray-800 truncate">{p.nombre_estandar}</span>
                          <span className="block font-mono text-[11px] text-gray-400">
                            {p.codigo ? `Cód ${p.codigo}` : p.ref ? `REF ${p.ref}` : 's/código'}{p.presentacion ? ` · ${p.presentacion}` : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tabla de parametrización */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Producto</th>
                      <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-3 py-3 w-28">Cant. mínima</th>
                      <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-3 py-3 w-28">Cant. máxima</th>
                      <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-3 py-3 w-20">Activo</th>
                      {puedeGestionar && <th className="px-3 py-3 w-10" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rowsSede.length === 0 && (
                      <tr><td colSpan={puedeGestionar ? 5 : 4} className="py-14 text-center">
                        <Package className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                        <p className="font-body text-sm text-gray-400">Esta sede aún no tiene productos parametrizados.</p>
                      </td></tr>
                    )}
                    {rowsSede.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50/60">
                        <td className="px-4 py-2.5">
                          <p className="font-body text-sm font-medium text-gray-900 truncate max-w-[280px]">{r.prod?.nombre_estandar ?? '—'}</p>
                          <p className="font-mono text-[11px] text-gray-400">
                            {r.prod?.codigo ? `Cód ${r.prod.codigo}` : r.prod?.ref ? `REF ${r.prod.ref}` : ''}{r.prod?.presentacion ? ` · ${r.prod.presentacion}` : ''}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <input type="number" min={0} step="1" defaultValue={r.cantidad_minima ?? 0} disabled={!puedeGestionar}
                            onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== (r.cantidad_minima ?? 0)) actualizar(r.id, { cantidad_minima: v }) }}
                            className={`${inputCls} text-center disabled:bg-gray-50`} />
                        </td>
                        <td className="px-3 py-2.5">
                          <input type="number" min={0} step="1" defaultValue={r.cantidad_maxima} disabled={!puedeGestionar}
                            onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== r.cantidad_maxima) actualizar(r.id, { cantidad_maxima: v }) }}
                            className={`${inputCls} text-center font-semibold disabled:bg-gray-50`} />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button type="button" disabled={!puedeGestionar} onClick={() => actualizar(r.id, { activo: !r.activo })}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.activo ? 'bg-brand-green' : 'bg-gray-200'} disabled:opacity-60`}>
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${r.activo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                        </td>
                        {puedeGestionar && (
                          <td className="px-3 py-2.5 text-center">
                            <button onClick={() => eliminar(r.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
