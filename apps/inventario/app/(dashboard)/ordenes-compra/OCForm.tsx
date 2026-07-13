'use client'
import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { crearOC, type ActionResult } from './actions'

interface Producto { id: string; nombre_estandar: string; presentacion: string | null; precio_lista: number | null }
interface Proveedor { id: string; nombre: string }
interface Linea { key: number; producto_id: string; cantidad: string; precio: string }

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {pending ? 'Guardando...' : 'Crear orden'}
    </button>
  )
}

interface Initial { proveedor_id?: string; producto_id?: string; precio?: string }

export function OCForm({ proveedores, productos, initial }: { proveedores: Proveedor[]; productos: Producto[]; initial?: Initial }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(crearOC, {})
  const [lineas, setLineas] = useState<Linea[]>([
    { key: 1, producto_id: initial?.producto_id ?? '', cantidad: initial?.producto_id ? '1' : '', precio: initial?.precio ?? '' },
  ])

  function addLinea() { setLineas(l => [...l, { key: Math.max(0, ...l.map(x => x.key)) + 1, producto_id: '', cantidad: '', precio: '' }]) }
  function rmLinea(key: number) { setLineas(l => l.length > 1 ? l.filter(x => x.key !== key) : l) }
  function setLinea(key: number, patch: Partial<Linea>) {
    setLineas(l => l.map(x => {
      if (x.key !== key) return x
      const next = { ...x, ...patch }
      if (patch.producto_id && !patch.precio) {
        const p = productos.find(pr => pr.id === patch.producto_id)
        if (p?.precio_lista) next.precio = String(p.precio_lista)
      }
      return next
    }))
  }

  const total = useMemo(() => lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0), [lineas])
  const periodoDefault = new Date().toISOString().slice(0, 7)

  return (
    <form action={formAction} className="space-y-6 max-w-4xl">
      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Datos de la orden</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="font-body font-semibold text-sm text-gray-700">Proveedor *</label>
            <select name="proveedor_id" required defaultValue={initial?.proveedor_id ?? ''} className={inputCls + ' mt-1 bg-white'}>
              <option value="" disabled>— Selecciona —</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
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
            return (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-6">
                  <select value={l.producto_id} onChange={e => setLinea(l.key, { producto_id: e.target.value })} className={inputCls + ' bg-white'}>
                    <option value="">— Producto —</option>
                    {productos.map(p => <option key={p.id} value={p.id}>{p.nombre_estandar}{p.presentacion ? ` · ${p.presentacion}` : ''}</option>)}
                  </select>
                  <input type="hidden" name="item_producto" value={l.producto_id} />
                </div>
                <div className="col-span-2">
                  <input name="item_cantidad" type="number" min="0" step="0.01" value={l.cantidad}
                    onChange={e => setLinea(l.key, { cantidad: e.target.value })} placeholder="Cant." className={inputCls} />
                </div>
                <div className="col-span-2">
                  <input name="item_precio" type="number" min="0" step="0.01" value={l.precio}
                    onChange={e => setLinea(l.key, { precio: e.target.value })} placeholder="Precio" className={inputCls} />
                </div>
                <div className="col-span-1 text-right font-body text-xs text-gray-600">{subtotal > 0 ? cop.format(subtotal) : '—'}</div>
                <div className="col-span-1 text-center">
                  <button type="button" onClick={() => rmLinea(l.key)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
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
        <SubmitBtn />
        <Link href="/ordenes-compra" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>
    </form>
  )
}
