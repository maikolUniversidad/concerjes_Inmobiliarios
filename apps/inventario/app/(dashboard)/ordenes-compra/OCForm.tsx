'use client'
import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save, Plus, Trash2, Store } from 'lucide-react'
import Link from 'next/link'
import { crearOC, type ActionResult } from './actions'

interface PrecioProv { proveedor_id: string; precio: number | null }
interface Producto { id: string; nombre_estandar: string; presentacion: string | null; precio_lista: number | null; precios: PrecioProv[] | null }
interface Proveedor { id: string; nombre: string }
interface Linea { key: number; producto_id: string; proveedor_id: string; cantidad: string; precio: string }
interface Initial { proveedor_id?: string; producto_id?: string; precio?: string }

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

function SubmitBtn({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending || disabled}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {pending ? 'Guardando...' : 'Crear orden'}
    </button>
  )
}

export function OCForm({ proveedores, productos, initial }: { proveedores: Proveedor[]; productos: Producto[]; initial?: Initial }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(crearOC, {})
  const prodMap = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos])
  const provName = (id: string) => proveedores.find(p => p.id === id)?.nombre ?? '—'

  const [proveedor, setProveedor] = useState(initial?.proveedor_id ?? '')
  const [lineas, setLineas] = useState<Linea[]>([
    { key: 1, producto_id: initial?.producto_id ?? '', proveedor_id: initial?.proveedor_id ?? '', cantidad: initial?.producto_id ? '1' : '', precio: initial?.precio ?? '' },
  ])

  const precioDe = (productoId: string, provId: string): number | null =>
    prodMap.get(productoId)?.precios?.find(x => x.proveedor_id === provId)?.precio ?? null

  // Proveedores relacionados con un producto (de la matriz precios_proveedor)
  const proveedoresDe = (productoId: string): { id: string; nombre: string; precio: number | null }[] => {
    const p = prodMap.get(productoId)
    if (!p?.precios?.length) return []
    return p.precios
      .map(x => ({ id: x.proveedor_id, nombre: provName(x.proveedor_id), precio: x.precio }))
      .sort((a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity))
  }

  function addLinea() { setLineas(l => [...l, { key: Math.max(0, ...l.map(x => x.key)) + 1, producto_id: '', proveedor_id: proveedor, cantidad: '', precio: '' }]) }
  function rmLinea(key: number) { setLineas(l => l.length > 1 ? l.filter(x => x.key !== key) : l) }

  // Al elegir producto: si el proveedor de la orden lo ofrece, autollena precio;
  // si no hay proveedor aún y el producto tiene uno solo, lo propone.
  function setProducto(key: number, producto_id: string) {
    setLineas(ls => ls.map(l => {
      if (l.key !== key) return l
      const rel = proveedoresDe(producto_id)
      let prov = l.proveedor_id || proveedor
      if (prov && !rel.some(r => r.id === prov)) prov = ''            // el proveedor actual no ofrece este producto
      if (!prov && rel.length === 1) prov = rel[0].id                 // único proveedor → autoselección
      const pr = prov ? precioDe(producto_id, prov) : null
      const precio = pr != null ? String(pr) : (prodMap.get(producto_id)?.precio_lista ? String(prodMap.get(producto_id)!.precio_lista) : l.precio)
      return { ...l, producto_id, proveedor_id: prov, precio }
    }))
  }

  // Elegir proveedor en una línea = proveedor de TODA la orden (una OC = un proveedor).
  // Propaga a las demás líneas y recalcula precios donde ese proveedor tenga cotización.
  function elegirProveedor(provId: string) {
    setProveedor(provId)
    setLineas(ls => ls.map(l => {
      if (!l.producto_id) return { ...l, proveedor_id: provId }
      const pr = precioDe(l.producto_id, provId)
      return { ...l, proveedor_id: provId, precio: pr != null ? String(pr) : l.precio }
    }))
  }

  function setCampo(key: number, patch: Partial<Linea>) {
    setLineas(l => l.map(x => x.key === key ? { ...x, ...patch } : x))
  }

  const total = useMemo(() => lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0), [lineas])
  const periodoDefault = new Date().toISOString().slice(0, 7)

  // Validación: una OC = un solo proveedor
  const provsUsados = Array.from(new Set(lineas.filter(l => l.producto_id).map(l => l.proveedor_id).filter(Boolean)))
  const multiProv = provsUsados.length > 1
  const ocProveedor = provsUsados.length === 1 ? provsUsados[0] : proveedor

  return (
    <form action={formAction} className="space-y-6 max-w-4xl">
      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <input type="hidden" name="proveedor_id" value={ocProveedor} />

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Datos de la orden</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1">
            <label className="font-body font-semibold text-sm text-gray-700">Proveedor de la orden</label>
            <div className={inputCls + ' mt-1 flex items-center gap-2 bg-gray-50'}>
              <Store className="w-4 h-4 text-gray-400 shrink-0" />
              <span className={ocProveedor ? 'text-gray-800' : 'text-gray-400'}>{ocProveedor ? provName(ocProveedor) : 'Se define al elegir productos'}</span>
            </div>
          </div>
          <div>
            <label className="font-body font-semibold text-sm text-gray-700">Período</label>
            <input name="periodo" type="month" defaultValue={periodoDefault} className={inputCls + ' mt-1'} />
          </div>
          <div>
            <label className="font-body font-semibold text-sm text-gray-700">Fecha de entrega</label>
            <input name="fecha_entrega" type="date" className={inputCls + ' mt-1'} />
          </div>
        </div>
        {multiProv && (
          <p className="flex items-center gap-1.5 font-body text-xs text-amber-600">
            <AlertCircle className="w-3.5 h-3.5" /> Una orden de compra es para un solo proveedor. Deja todos los ítems con el mismo proveedor.
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-lg text-gray-900">Ítems</h2>
          <button type="button" onClick={addLinea}
            className="flex items-center gap-1.5 border border-brand-green text-brand-green font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-green-50">
            <Plus className="w-3.5 h-3.5" /> Agregar ítem
          </button>
        </div>

        <div className="space-y-2">
          {lineas.map(l => {
            const subtotal = (Number(l.cantidad) || 0) * (Number(l.precio) || 0)
            const rel = l.producto_id ? proveedoresDe(l.producto_id) : []
            return (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-12 sm:col-span-4">
                  <select value={l.producto_id} onChange={e => setProducto(l.key, e.target.value)} className={inputCls + ' bg-white'}>
                    <option value="">— Producto —</option>
                    {productos.map(p => <option key={p.id} value={p.id}>{p.nombre_estandar}{p.presentacion ? ` · ${p.presentacion}` : ''}</option>)}
                  </select>
                  <input type="hidden" name="item_producto" value={l.producto_id} />
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <select value={l.proveedor_id} onChange={e => elegirProveedor(e.target.value)}
                    disabled={!l.producto_id}
                    className={inputCls + ' bg-white disabled:bg-gray-50 disabled:text-gray-400'}>
                    <option value="">{rel.length ? '— Proveedor —' : 'Sin proveedores relacionados'}</option>
                    {rel.map(r => <option key={r.id} value={r.id}>{r.nombre}{r.precio != null ? ` · ${cop.format(r.precio)}` : ''}</option>)}
                    {/* fallback: permitir cualquier proveedor si el producto no tiene relación */}
                    {rel.length === 0 && proveedores.map(pv => <option key={pv.id} value={pv.id}>{pv.nombre}</option>)}
                  </select>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <input name="item_cantidad" type="number" min="0" step="0.01" value={l.cantidad}
                    onChange={e => setCampo(l.key, { cantidad: e.target.value })} placeholder="Cant." className={inputCls} />
                </div>
                <div className="col-span-5 sm:col-span-2">
                  <input name="item_precio" type="number" min="0" step="0.01" value={l.precio}
                    onChange={e => setCampo(l.key, { precio: e.target.value })} placeholder="Precio" className={inputCls} />
                </div>
                <div className="col-span-3 sm:col-span-1 flex items-center justify-end gap-2">
                  <span className="hidden sm:block font-body text-[11px] text-gray-500 text-right truncate">{subtotal > 0 ? cop.format(subtotal) : ''}</span>
                  <button type="button" onClick={() => rmLinea(l.key)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end pt-3 border-t border-gray-100">
          <div className="text-right">
            <p className="font-body text-xs text-gray-400">Valor total</p>
            <p className="font-heading font-bold text-2xl text-gray-900">{cop.format(total)}</p>
          </div>
        </div>

        <div>
          <label className="font-body font-semibold text-sm text-gray-700">Observaciones</label>
          <textarea name="observaciones" rows={2} className={inputCls + ' mt-1 resize-none'} placeholder="Opcional" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitBtn disabled={multiProv || !ocProveedor} />
        <Link href="/ordenes-compra" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>
    </form>
  )
}
