'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Ban, Send, ShoppingCart, ThumbsDown } from 'lucide-react'
import { formatCOP, type EstadoSolicitud } from '@/lib/solicitudes-compra'
import { cambiarEstadoSolicitud, convertirSolicitudEnOC, type OCGenerada } from '../actions'

/**
 * Botones del detalle. Quién puede qué:
 *   · enviar y anular  → `solicitar_compras` (quien pide)
 *   · convertir y rechazar → `crear_ordenes_compra` (compras)
 * La base valida lo mismo en los RPC, así que esconder un botón no es el control.
 */
export function AccionesSolicitud({
  id,
  numero,
  estado,
  puedeSolicitar,
  puedeConvertir,
}: {
  id: string
  numero: string
  estado: EstadoSolicitud
  puedeSolicitar: boolean
  puedeConvertir: boolean
}) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ordenes, setOrdenes] = useState<OCGenerada[] | null>(null)
  const [restantes, setRestantes] = useState(0)

  const correr = (fn: () => Promise<{ error?: string }>) => {
    setError(null)
    iniciar(async () => {
      const res = await fn()
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function convertir() {
    if (!confirm(`¿Convertir ${numero} en orden(es) de compra? Se crea una orden por proveedor, en borrador.`)) return
    setError(null)
    iniciar(async () => {
      const res = await convertirSolicitudEnOC(id)
      if (res.error) { setError(res.error); return }
      setOrdenes(res.ordenes ?? [])
      setRestantes(res.sinProveedor ?? 0)
      router.refresh()
    })
  }

  function cambiar(nuevo: 'ENVIADA' | 'RECHAZADA' | 'ANULADA') {
    if (nuevo === 'ENVIADA') { correr(() => cambiarEstadoSolicitud(id, 'ENVIADA')); return }
    const motivo = prompt(nuevo === 'RECHAZADA' ? '¿Por qué se rechaza la solicitud?' : '¿Por qué se anula la solicitud?')
    if (!motivo?.trim()) return
    correr(() => cambiarEstadoSolicitud(id, nuevo, motivo))
  }

  const abierta = estado === 'BORRADOR' || estado === 'ENVIADA' || estado === 'PARCIAL'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {puedeSolicitar && estado === 'BORRADOR' && (
          <button type="button" onClick={() => cambiar('ENVIADA')} disabled={pendiente}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm font-semibold text-gray-700 transition-colors hover:border-brand-green hover:text-brand-green disabled:opacity-50">
            <Send className="h-4 w-4" /> Enviar a compras
          </button>
        )}
        {puedeConvertir && (
          <button type="button" onClick={convertir} disabled={pendiente}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-green-dark disabled:opacity-50">
            <ShoppingCart className="h-4 w-4" /> {pendiente ? 'Convirtiendo…' : 'Convertir en orden'}
          </button>
        )}
        {abierta && (
          <>
            <button type="button" onClick={() => cambiar('RECHAZADA')} disabled={pendiente}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm text-gray-600 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50">
              <ThumbsDown className="h-4 w-4" /> Rechazar
            </button>
            {puedeSolicitar && (
              <button type="button" onClick={() => cambiar('ANULADA')} disabled={pendiente}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm text-gray-600 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50">
                <Ban className="h-4 w-4" /> Anular
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700">{error}</p>
      )}

      {ordenes && ordenes.length > 0 && (
        <div className="max-w-md rounded-lg border border-green-200 bg-green-50 px-3 py-2 font-body text-sm text-green-800">
          {ordenes.length} orden(es) creada(s):
          <ul className="mt-1 space-y-0.5">
            {ordenes.map((o) => (
              <li key={o.oc_id}>
                <Link href={`/ordenes-compra/${o.oc_id}`} className="font-mono font-semibold underline">{o.numero}</Link>
                {' · '}{o.proveedor ?? 'sin proveedor'}{' · '}{formatCOP(o.valor)}
              </li>
            ))}
          </ul>
          {restantes > 0 && (
            <p className="mt-1 text-green-900/80">
              {restantes} producto(s) sin proveedor quedaron en la solicitud.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
