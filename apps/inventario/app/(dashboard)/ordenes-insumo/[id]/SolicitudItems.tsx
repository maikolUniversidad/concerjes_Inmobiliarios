'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Plus, Trash2, Search, Loader2, User2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { actualizarItemSolicitado, agregarItemSolicitado, quitarItemSolicitado } from '../actions'

interface Item {
  id: string
  producto_id: string
  cantidad_solicitada: number
  es_adicional?: boolean
  modificado_nombre?: string | null
  modificado_at?: string | null
  producto: { nombre_estandar: string; presentacion: string | null } | null
}
interface ProdOpt { id: string; nombre: string; presentacion: string | null }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

function fmtCorto(iso?: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Editor de la SOLICITUD (etapa de borrador / cambios solicitados).
 * Aquí se ajustan cantidades y se agregan o quitan productos. Cada cambio deja
 * quién lo hizo en la columna "Modificado por" y en la trazabilidad.
 * El alistamiento/despacho NO vive aquí: aparece una vez la orden está aprobada.
 */
export function SolicitudItems({ ordenId, items: itemsIniciales, puedeEditar }: {
  ordenId: string
  items: Item[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [items, setItems] = useState<Item[]>(itemsIniciales ?? [])
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    () => Object.fromEntries((itemsIniciales ?? []).map((i) => [i.id, Number(i.cantidad_solicitada)])),
  )
  const [catalogo, setCatalogo] = useState<ProdOpt[]>([])
  const [buscar, setBuscar] = useState('')
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setItems(itemsIniciales ?? [])
    setCantidades(Object.fromEntries((itemsIniciales ?? []).map((i) => [i.id, Number(i.cantidad_solicitada)])))
  }, [itemsIniciales])

  // Catálogo para agregar productos (solo si se puede editar).
  useEffect(() => {
    if (!puedeEditar) return
    sb.from('productos').select('id, nombre_estandar, presentacion').eq('activo', true)
      .order('nombre_estandar').limit(5000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any[] | null }) => {
        setCatalogo((data ?? []).map((p) => ({ id: p.id, nombre: p.nombre_estandar, presentacion: p.presentacion ?? null })))
      })
  }, [sb, puedeEditar])

  const yaEnOrden = useMemo(() => new Set(items.map((i) => i.producto_id)), [items])

  const sugerencias = useMemo(() => {
    const q = norm(buscar.trim())
    const libres = catalogo.filter((p) => !yaEnOrden.has(p.id))
    if (!q) return libres.slice(0, 8)
    const tokens = q.split(/\s+/)
    return libres.filter((p) => {
      const hay = norm(`${p.nombre} ${p.presentacion ?? ''}`)
      return tokens.every((t) => hay.includes(t))
    }).slice(0, 8)
  }, [buscar, catalogo, yaEnOrden])

  function guardarCantidad(it: Item) {
    const nueva = Math.max(0, Number(cantidades[it.id]) || 0)
    if (nueva === Number(it.cantidad_solicitada)) return
    start(async () => {
      const r = await actualizarItemSolicitado(ordenId, it.id, nueva)
      if (r.error) { toast.error(r.error); return }
      toast.success('Cantidad actualizada')
      router.refresh()
    })
  }

  function agregar(p: ProdOpt) {
    setBusy(p.id)
    start(async () => {
      const r = await agregarItemSolicitado(ordenId, p.id, 1, true)
      setBusy(null)
      if (r.error) { toast.error(r.error); return }
      toast.success(`«${p.nombre}» agregado`)
      setBuscar('')
      router.refresh()
    })
  }

  function quitar(it: Item) {
    if (!window.confirm(`¿Quitar «${it.producto?.nombre_estandar ?? 'producto'}» de la orden?`)) return
    setBusy(it.id)
    start(async () => {
      const r = await quitarItemSolicitado(ordenId, it.id)
      setBusy(null)
      if (r.error) { toast.error(r.error); return }
      toast.success('Producto quitado')
      router.refresh()
    })
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-green" /> Productos de la solicitud
        </p>
        <span className="font-body text-xs text-gray-400">{items.length} ítem(s)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left  font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Producto</th>
              <th className="text-left  font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-32">Tipo</th>
              <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-28">Cantidad</th>
              <th className="text-left  font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-44">Modificado por</th>
              {puedeEditar && <th className="w-12 px-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((it) => (
              <tr key={it.id} className={it.es_adicional ? 'bg-amber-50/30' : ''}>
                <td className="px-4 py-2.5">
                  <p className="font-body text-sm text-gray-900 truncate max-w-[260px]">{it.producto?.nombre_estandar ?? '—'}</p>
                  {it.producto?.presentacion && <p className="font-body text-[11px] text-gray-400">{it.producto.presentacion}</p>}
                </td>
                <td className="px-3 py-2.5">
                  {it.es_adicional ? (
                    <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Adicional</span>
                  ) : (
                    <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">Parametrizado</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {puedeEditar ? (
                    <input type="number" min={0} step="1"
                      value={cantidades[it.id] ?? 0}
                      onChange={(e) => setCantidades((prev) => ({ ...prev, [it.id]: Number(e.target.value) || 0 }))}
                      onBlur={() => guardarCantidad(it)}
                      disabled={pending}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 font-body text-sm text-center outline-none focus:border-brand-green disabled:bg-gray-50" />
                  ) : (
                    <span className="font-body text-sm font-semibold text-gray-700">{Number(it.cantidad_solicitada)}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {it.modificado_nombre ? (
                    <span className="inline-flex items-center gap-1.5 font-body text-xs text-gray-600">
                      <User2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate max-w-[130px]">{it.modificado_nombre}</span>
                        {it.modificado_at && <span className="block text-[10px] text-gray-400">{fmtCorto(it.modificado_at)}</span>}
                      </span>
                    </span>
                  ) : (
                    <span className="font-body text-xs text-gray-300">—</span>
                  )}
                </td>
                {puedeEditar && (
                  <td className="px-2 py-2.5 text-center">
                    <button onClick={() => quitar(it)} disabled={busy === it.id || pending}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
                      {busy === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={puedeEditar ? 5 : 4} className="py-10 text-center font-body text-sm text-gray-400">La orden no tiene productos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Agregar producto */}
      {puedeEditar && (
        <div className="border-t border-gray-100 p-4 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar producto para agregar…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
          </div>
          {buscar.trim() && sugerencias.length === 0 && (
            <p className="font-body text-xs text-gray-400 px-1">No existe ningún producto en el inventario para «{buscar.trim()}».</p>
          )}
          {sugerencias.length > 0 && (
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 overflow-hidden">
              {sugerencias.map((p) => (
                <button key={p.id} onClick={() => agregar(p)} disabled={busy === p.id || pending}
                  className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 hover:bg-green-50 disabled:opacity-50">
                  <span className="min-w-0">
                    <span className="font-body text-sm text-gray-800">{p.nombre}</span>
                    {p.presentacion && <span className="font-body text-xs text-gray-400"> · {p.presentacion}</span>}
                  </span>
                  {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-green shrink-0" /> : <Plus className="w-4 h-4 text-brand-green shrink-0" />}
                </button>
              ))}
            </div>
          )}
          <p className="font-body text-[11px] text-gray-400">
            Los productos que agregues aquí quedan marcados como <span className="font-semibold text-amber-700">Adicional</span> (fuera de la parametrización, sin tope).
          </p>
        </div>
      )}
    </div>
  )
}
