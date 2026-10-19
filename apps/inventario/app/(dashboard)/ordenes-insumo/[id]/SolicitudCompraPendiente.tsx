'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import { generarSolicitudPendiente } from '../../solicitudes-compra/actions'

/**
 * «Generar solicitud de compra» desde una orden pendiente por falta de stock.
 *
 * Es la única puerta donde la solicitud sale gratis (docs/modulo-compras.md
 * §7.1): esta orden existe justamente porque no había stock, así que el sistema
 * ya sabe qué producto, cuánto, para qué sede y quién lo pidió.
 */
export function SolicitudCompraPendiente({
  ordenId,
  solicitudes,
  puedeSolicitar,
}: {
  ordenId: string
  solicitudes: { id: string; numero: string; estado: string }[]
  puedeSolicitar: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()

  function generar() {
    setError(null)
    iniciar(async () => {
      const res = await generarSolicitudPendiente(ordenId)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5 border-t border-orange-200 pt-2">
      {solicitudes.length > 0 ? (
        <p className="font-body text-sm text-orange-900/90">
          Solicitud de compra:{' '}
          {solicitudes.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link href={`/solicitudes-compra/${s.id}`} className="font-semibold underline">{s.numero}</Link>
              {' '}({s.estado.replace(/_/g, ' ').toLowerCase()})
            </span>
          ))}
        </p>
      ) : (
        <p className="font-body text-sm text-orange-900/90">
          Lo que falta aquí no se ha pedido a ningún proveedor todavía.
        </p>
      )}

      {puedeSolicitar && (
        <button type="button" onClick={generar} disabled={pendiente}
          className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-white px-3 py-1.5 font-body text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-100 disabled:opacity-50">
          <ShoppingCart className="h-3.5 w-3.5" />
          {pendiente ? 'Generando…' : solicitudes.length > 0 ? 'Generar solicitud por lo que falte' : 'Generar solicitud de compra'}
        </button>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}
