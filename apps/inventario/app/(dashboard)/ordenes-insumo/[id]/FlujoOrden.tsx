'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Send, CheckCircle2, MessageSquare, Loader2, PenLine, ArrowRight, Clock,
} from 'lucide-react'
import { enviarARevision, solicitarCambios, aprobarOrden, comentarOrden } from '../actions'

export interface EventoOrden {
  id: string
  tipo: string
  mensaje: string | null
  estado_anterior: string | null
  estado_nuevo: string | null
  usuario_nombre: string | null
  created_at: string
}

const TIPO_META: Record<string, { label: string; color: string }> = {
  CREACION:            { label: 'Propuesta creada',   color: 'bg-gray-100 text-gray-700' },
  ENVIO_REVISION:      { label: 'Enviada a revisión', color: 'bg-blue-100 text-blue-700' },
  CAMBIOS_SOLICITADOS: { label: 'Cambios solicitados', color: 'bg-amber-100 text-amber-800' },
  APROBACION:          { label: 'Aprobada',           color: 'bg-green-100 text-green-700' },
  COMENTARIO:          { label: 'Comentario',         color: 'bg-gray-100 text-gray-600' },
  ALISTAMIENTO:        { label: 'Alistamiento',       color: 'bg-violet-100 text-violet-700' },
  DESPACHO:            { label: 'Despacho',           color: 'bg-emerald-100 text-emerald-700' },
  ANULACION:           { label: 'Anulada',            color: 'bg-red-100 text-red-700' },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Flujo de aprobación de la orden (coordinador de sede ⇄ central) + trazabilidad.
 * El alistamiento en bodega solo se habilita cuando la orden queda APROBADA.
 */
export function FlujoOrden({ ordenId, estado, eventos, puedeProponer, puedeAprobar }: {
  ordenId: string
  estado: string
  eventos: EventoOrden[]
  puedeProponer: boolean
  puedeAprobar: boolean
}) {
  const router = useRouter()
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()

  const editable = ['BORRADOR', 'CAMBIOS_SOLICITADOS'].includes(estado)
  const enRevision = estado === 'EN_REVISION'

  function run(fn: () => Promise<{ error?: string; ok?: boolean }>, exito: string) {
    start(async () => {
      const r = await fn()
      if (r.error) { toast.error(r.error); return }
      toast.success(exito)
      setMsg('')
      router.refresh()
    })
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <PenLine className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-base text-gray-900">Solicitud y aprobación</h2>
      </div>

      {/* Guía del estado actual */}
      <p className="font-body text-sm text-gray-500">
        {estado === 'BORRADOR' && 'Propuesta en borrador. Ajusta las cantidades y envíala a la central cuando esté lista.'}
        {estado === 'EN_REVISION' && 'En revisión por la central. Puede aprobarla o solicitar cambios.'}
        {estado === 'CAMBIOS_SOLICITADOS' && 'La central solicitó cambios. Ajusta la propuesta y vuelve a enviarla.'}
        {estado === 'APROBADA' && 'Aprobada ✅ — ya está disponible en el módulo de Alistamiento de bodega.'}
        {['EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO'].includes(estado) && 'Aprobada. El proceso continúa en Alistamiento.'}
        {estado === 'ANULADA' && 'Orden anulada.'}
      </p>

      {/* Acciones del flujo */}
      {(puedeProponer || puedeAprobar) && !['DESPACHADO', 'ANULADA'].includes(estado) && (
        <div className="space-y-2">
          <textarea
            value={msg} onChange={(e) => setMsg(e.target.value)} rows={2}
            placeholder={enRevision && puedeAprobar ? 'Motivo de los cambios o nota de aprobación…' : 'Mensaje para la central (opcional)…'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green resize-none"
          />
          <div className="flex flex-wrap gap-2">
            {puedeProponer && editable && (
              <button onClick={() => run(() => enviarARevision(ordenId, msg), 'Enviada a la central')} disabled={pending}
                className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar a revisión
              </button>
            )}
            {puedeAprobar && enRevision && (
              <>
                <button onClick={() => run(() => aprobarOrden(ordenId, msg), 'Orden aprobada')} disabled={pending}
                  className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Aprobar
                </button>
                <button onClick={() => run(() => solicitarCambios(ordenId, msg), 'Cambios solicitados')} disabled={pending || !msg.trim()}
                  className="flex items-center gap-1.5 border border-amber-300 text-amber-800 font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-amber-50 disabled:opacity-50">
                  <ArrowRight className="w-4 h-4" /> Solicitar cambios
                </button>
              </>
            )}
            <button onClick={() => run(() => comentarOrden(ordenId, msg), 'Comentario agregado')} disabled={pending || !msg.trim()}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <MessageSquare className="w-4 h-4" /> Comentar
            </button>
          </div>
        </div>
      )}

      {/* Trazabilidad — de lado a lado */}
      <div className="pt-2 border-t border-gray-100">
        <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Trazabilidad
        </p>
        {eventos.length === 0 ? (
          <p className="font-body text-sm text-gray-400">Sin movimientos todavía.</p>
        ) : (
          <ol className="space-y-2.5">
            {eventos.map((e) => {
              const m = TIPO_META[e.tipo] ?? { label: e.tipo, color: 'bg-gray-100 text-gray-600' }
              return (
                <li key={e.id} className="flex gap-2.5">
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.color}`}>{m.label}</span>
                      <span className="font-body text-xs text-gray-400">{e.usuario_nombre ?? 'Sistema'} · {fmt(e.created_at)}</span>
                    </div>
                    {e.mensaje && <p className="font-body text-sm text-gray-700 mt-0.5">{e.mensaje}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
