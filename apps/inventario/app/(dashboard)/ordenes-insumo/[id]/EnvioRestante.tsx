'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Truck, Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { registrarEnvioRestante } from '../actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ItemIn {
  id: string
  cantidad_solicitada: number
  cantidad_alistada: number
  producto: { nombre_estandar: string; presentacion: string | null; imagen_url?: string | null; stock?: { cantidad_disp: number } | { cantidad_disp: number }[] | null } | null
}

const stockDisp = (it: ItemIn): number => {
  const s = it.producto?.stock
  if (!s) return 0
  return Array.isArray(s) ? Number(s[0]?.cantidad_disp ?? 0) : Number(s.cantidad_disp ?? 0)
}

/**
 * Envío restante: para una orden ya despachada que salió incompleta, permite
 * enviar lo que quedó pendiente (registra SALIDA de stock y queda en trazabilidad).
 */
export function EnvioRestante({ ordenId, items, puedeAlistar }: {
  ordenId: string; items: ItemIn[]; puedeAlistar: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const pendientes = useMemo(
    () => items.filter(it => Number(it.cantidad_solicitada) - Number(it.cantidad_alistada) > 0),
    [items],
  )
  const [cant, setCant] = useState<Record<string, number>>(() =>
    Object.fromEntries(pendientes.map(it => [it.id, Number(it.cantidad_solicitada) - Number(it.cantidad_alistada)])),
  )

  if (pendientes.length === 0) return null

  const totalPend = pendientes.reduce((a, it) => a + (Number(it.cantidad_solicitada) - Number(it.cantidad_alistada)), 0)

  function registrar() {
    const envios = pendientes
      .map(it => ({ itemId: it.id, cantidad: Number(cant[it.id]) || 0 }))
      .filter(e => e.cantidad > 0)
    if (envios.length === 0) { toast.error('Indica al menos una cantidad a enviar.'); return }
    start(async () => {
      const r = await registrarEnvioRestante(ordenId, envios)
      if (r.error) { toast.error(r.error); return }
      toast.success('Envío restante registrado.'); router.refresh()
    })
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-amber-100 px-5 py-3 text-amber-800">
        <AlertTriangle className="w-4 h-4" />
        <h2 className="font-heading font-semibold text-sm">Envío restante</h2>
        <span className="rounded-full bg-amber-500 px-2 py-0.5 font-body text-[11px] font-bold text-white">{pendientes.length} ítem · {totalPend} und</span>
      </div>
      <p className="px-5 pt-2 font-body text-xs text-gray-500">
        Esta orden se despachó con productos pendientes. Envía lo que falta: se descuenta del inventario y queda registrado en la trazabilidad.
      </p>

      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left font-body text-[11px] uppercase tracking-wide text-gray-400">
              <th className="px-2 py-1.5">Producto</th>
              <th className="px-2 py-1.5 text-right">Pedido</th>
              <th className="px-2 py-1.5 text-right">Enviado</th>
              <th className="px-2 py-1.5 text-right">Pendiente</th>
              <th className="px-2 py-1.5 text-right">Stock</th>
              {puedeAlistar && <th className="px-2 py-1.5 text-center w-28">Enviar ahora</th>}
            </tr>
          </thead>
          <tbody>
            {pendientes.map(it => {
              const pend = Number(it.cantidad_solicitada) - Number(it.cantidad_alistada)
              const disp = stockDisp(it)
              const val = Number(cant[it.id]) || 0
              const sinStock = val > disp
              return (
                <tr key={it.id} className="border-t border-amber-100/70 align-middle">
                  <td className="px-2 py-2">
                    <p className="font-body text-sm text-gray-900">{it.producto?.nombre_estandar ?? '—'}</p>
                    {it.producto?.presentacion && <p className="font-body text-[11px] text-gray-400">{it.producto.presentacion}</p>}
                  </td>
                  <td className="px-2 py-2 text-right font-body text-gray-600">{Number(it.cantidad_solicitada)}</td>
                  <td className="px-2 py-2 text-right font-body text-gray-600">{Number(it.cantidad_alistada)}</td>
                  <td className="px-2 py-2 text-right font-heading font-bold text-amber-700">{pend}</td>
                  <td className={`px-2 py-2 text-right font-body ${disp <= 0 ? 'text-red-500' : 'text-gray-500'}`}>{disp}</td>
                  {puedeAlistar && (
                    <td className="px-2 py-2 text-center">
                      <input type="number" min={0} max={pend} value={cant[it.id] ?? 0}
                        onChange={e => setCant(c => ({ ...c, [it.id]: Math.max(0, Math.min(pend, Number(e.target.value) || 0)) }))}
                        className={`w-20 rounded-lg border px-2 py-1 text-sm text-right outline-none focus:border-brand-green ${sinStock ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                      {sinStock && <p className="font-body text-[10px] text-red-500 mt-0.5">supera stock</p>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {puedeAlistar ? (
        <div className="flex items-center justify-end gap-2 border-t border-amber-100 px-5 py-3">
          <button onClick={registrar} disabled={pending}
            className="flex items-center gap-2 bg-amber-600 text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-amber-700 disabled:opacity-50">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Registrar envío restante
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 px-5 py-3 border-t border-amber-100 font-body text-xs text-gray-400">
          <PackageCheck className="w-3.5 h-3.5" /> Solo bodega (permiso de alistamiento) puede registrar el envío restante.
        </p>
      )}
    </div>
  )
}
