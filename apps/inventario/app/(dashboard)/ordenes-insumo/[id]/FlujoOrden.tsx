'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Send, CheckCircle2, MessageSquare, Loader2, PenLine, ArrowRight, Clock, PackageCheck,
} from 'lucide-react'
import { enviarARevision, solicitarCambios, aprobarOrden, comentarOrden, confirmarRecepcion } from '../actions'

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
  APROBACION:          { label: 'Visto bueno',        color: 'bg-green-100 text-green-700' },
  RECEPCION:           { label: 'Recibido en sede',   color: 'bg-emerald-100 text-emerald-800' },
  COMENTARIO:          { label: 'Comentario',         color: 'bg-gray-100 text-gray-600' },
  ALISTAMIENTO:        { label: 'Alistamiento',       color: 'bg-violet-100 text-violet-700' },
  DESPACHO:            { label: 'Enviado',            color: 'bg-emerald-100 text-emerald-700' },
  ANULACION:           { label: 'Anulada',            color: 'bg-red-100 text-red-700' },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Línea de estado del proceso: quién hace cada etapa. */
const PASOS = [
  { key: 'BORRADOR',     label: 'Borrador',     quien: 'Supervisor de sede' },
  { key: 'APROBADA',     label: 'Aprobado',     quien: 'Solicitante + Coordinador' },
  { key: 'ALISTAMIENTO', label: 'Alistamiento', quien: 'Bodega' },
  { key: 'ENVIADO',      label: 'Enviado',      quien: 'Despacho' },
  { key: 'RECIBIDO',     label: 'Recibido',     quien: 'Supervisor del contrato' },
]

/** Índice del paso actual según el estado real de la orden. */
function pasoActual(estado: string): number {
  switch (estado) {
    case 'BORRADOR': case 'EN_REVISION': case 'CAMBIOS_SOLICITADOS': return 0
    case 'APROBADA': return 1
    case 'PENDIENTE': case 'EN_ALISTAMIENTO': case 'ALISTADO': return 2
    case 'DESPACHADO': return 3
    case 'RECIBIDO': return 4
    default: return 0
  }
}

function LineaEstado({ estado }: { estado: string }) {
  const actual = pasoActual(estado)
  const anulada = estado === 'ANULADA'
  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex items-start gap-1 min-w-[520px]">
        {PASOS.map((p, i) => {
          const hecho = !anulada && i < actual
          const activo = !anulada && i === actual
          return (
            <li key={p.key} className="flex-1 flex items-start gap-1">
              <div className="flex-1">
                <div className={`h-1.5 rounded-full ${hecho ? 'bg-brand-green' : activo ? 'bg-brand-green/50' : 'bg-gray-200'}`} />
                <p className={`mt-1.5 font-body text-[11px] font-semibold ${hecho || activo ? 'text-gray-900' : 'text-gray-400'}`}>
                  {p.label}
                </p>
                <p className="font-body text-[10px] text-gray-400 leading-tight">{p.quien}</p>
              </div>
            </li>
          )
        })}
      </ol>
      {anulada && <p className="font-body text-xs text-red-600 mt-1">Orden anulada.</p>}
    </div>
  )
}

/**
 * Flujo de aprobación de la orden (coordinador de sede ⇄ central) + trazabilidad.
 * El alistamiento en bodega solo se habilita cuando la orden queda APROBADA.
 */
export function FlujoOrden({
  ordenId, estado, eventos, puedeProponer, puedeAprobar,
  firmaSolicitante, firmaCoordinador, esSolicitante, puedeRecibir,
}: {
  ordenId: string
  estado: string
  eventos: EventoOrden[]
  puedeProponer: boolean
  puedeAprobar: boolean
  /** Fecha del visto bueno de quien solicitó (null = pendiente). */
  firmaSolicitante: string | null
  /** Fecha del visto bueno del coordinador de conserjes (null = pendiente). */
  firmaCoordinador: string | null
  esSolicitante: boolean
  puedeRecibir: boolean
}) {
  const router = useRouter()
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()

  const editable = ['BORRADOR', 'CAMBIOS_SOLICITADOS'].includes(estado)
  const enRevision = estado === 'EN_REVISION'
  const enviada = estado === 'DESPACHADO'

  // Cada quien firma su lado; nadie firma dos veces.
  const miFirma = esSolicitante ? firmaSolicitante : firmaCoordinador
  const puedeFirmar = enRevision && !miFirma && (esSolicitante || puedeAprobar)

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

      {/* Línea de estado del proceso completo */}
      <LineaEstado estado={estado} />

      {/* Guía del estado actual */}
      <p className="font-body text-sm text-gray-500">
        {estado === 'BORRADOR' && 'Propuesta en borrador. Ajusta las cantidades y envíala a la central cuando esté lista.'}
        {estado === 'EN_REVISION' && 'En revisión por la central. Puede aprobarla o solicitar cambios.'}
        {estado === 'CAMBIOS_SOLICITADOS' && 'La central solicitó cambios. Ajusta la propuesta y vuelve a enviarla.'}
        {estado === 'APROBADA' && 'Aprobada por ambas partes ✅ — ya está disponible en Alistamiento de bodega.'}
        {['EN_ALISTAMIENTO', 'ALISTADO'].includes(estado) && 'Aprobada. El proceso continúa en Alistamiento.'}
        {estado === 'DESPACHADO' && 'Enviada. Falta el recibido del supervisor del contrato.'}
        {estado === 'RECIBIDO' && 'Recibida en sede. Proceso finalizado.'}
        {estado === 'ANULADA' && 'Orden anulada.'}
      </p>

      {/* Doble visto bueno: la orden solo avanza cuando firman los dos */}
      {!['BORRADOR', 'ANULADA'].includes(estado) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            { rol: 'Quien solicitó', firma: firmaSolicitante },
            { rol: 'Coordinador de conserjes', firma: firmaCoordinador },
          ] as const).map(({ rol, firma }) => (
            <div key={rol} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
              firma ? 'border-green-200 bg-green-50/60' : 'border-dashed border-gray-200'}`}>
              <CheckCircle2 className={`w-4 h-4 shrink-0 ${firma ? 'text-brand-green' : 'text-gray-300'}`} />
              <div className="min-w-0">
                <p className="font-body text-xs font-semibold text-gray-700">{rol}</p>
                <p className="font-body text-[11px] text-gray-500">
                  {firma ? `Aprobó · ${fmt(firma)}` : 'Pendiente de aprobar'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Acciones del flujo */}
      {(puedeProponer || puedeAprobar || (enviada && puedeRecibir)) && !['RECIBIDO', 'ANULADA'].includes(estado) && (
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
            {puedeFirmar && (
              <button onClick={() => run(() => aprobarOrden(ordenId, msg), 'Tu visto bueno quedó registrado')} disabled={pending}
                className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Dar mi aprobación {esSolicitante ? '(solicitante)' : '(coordinador)'}
              </button>
            )}
            {puedeAprobar && enRevision && (
              <button onClick={() => run(() => solicitarCambios(ordenId, msg), 'Cambios solicitados')} disabled={pending || !msg.trim()}
                className="flex items-center gap-1.5 border border-amber-300 text-amber-800 font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-amber-50 disabled:opacity-50">
                <ArrowRight className="w-4 h-4" /> Solicitar cambios
              </button>
            )}
            {enviada && puedeRecibir && (
              <button onClick={() => run(() => confirmarRecepcion(ordenId, msg), 'Recibido confirmado')} disabled={pending}
                className="flex items-center gap-1.5 bg-emerald-600 text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-60">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />} Dar el recibido
              </button>
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
