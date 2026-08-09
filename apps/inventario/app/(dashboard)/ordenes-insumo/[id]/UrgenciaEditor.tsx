'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarUrgencia } from '../actions'
import { calcularUrgencia, fmtFecha } from '../urgencia'

/**
 * Prioridad de la orden: fecha de entrega pactada + marca de urgente.
 * Muestra la etiqueta calculada y, si se puede editar, deja cambiarla.
 */
export function UrgenciaEditor({ ordenId, estado, urgente: urgIni, fechaEntrega: fechaIni, puedeEditar }: {
  ordenId: string
  estado: string
  urgente: boolean
  fechaEntrega: string | null
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [urgente, setUrgente] = useState(urgIni)
  const [fecha, setFecha] = useState(fechaIni ?? '')
  const [pending, start] = useTransition()

  const sinCambios = urgente === urgIni && (fecha || null) === (fechaIni || null)
  const urg = calcularUrgencia({ urgente: urgIni, fecha_entrega_pactada: fechaIni, estado })

  function guardar() {
    start(async () => {
      const r = await actualizarUrgencia(ordenId, { urgente, fechaEntrega: fecha || null })
      if (r.error) { toast.error(r.error); return }
      toast.success('Prioridad actualizada')
      router.refresh()
    })
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-brand-green" /> Prioridad y entrega
        </p>
        {urg.label && (
          <span className={`inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${urg.cls}`}>
            {urg.rank <= 1 && <AlertTriangle className="w-2.5 h-2.5" />}{urg.label}
          </span>
        )}
      </div>

      {!puedeEditar ? (
        <p className="font-body text-sm text-gray-500">
          {fechaIni ? `Entrega pactada: ${fmtFecha(fechaIni)}.` : 'Sin fecha de entrega pactada.'}
          {urgIni ? ' Marcada como urgente.' : ''}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block font-body text-xs font-semibold text-gray-600 mb-1">Fecha de entrega pactada</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
            </div>
            <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700 pb-2 cursor-pointer">
              <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-brand-green focus:ring-brand-green" />
              <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Marcar urgente</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={guardar} disabled={pending || sinCambios}
              className="inline-flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar prioridad
            </button>
            {fecha && (
              <button onClick={() => setFecha('')} disabled={pending}
                className="font-body text-xs text-gray-500 hover:text-red-600">Quitar fecha</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
