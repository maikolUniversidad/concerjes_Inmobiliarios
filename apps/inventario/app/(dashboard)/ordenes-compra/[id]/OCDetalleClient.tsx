'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check, Ban, Truck, PackageCheck, Loader2, MessageSquare, Send, FilePlus2,
  GitBranch, Pencil, Plus, Minus, ShoppingCart, ClipboardCheck, Building2, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { avanzarEstadoOC, registrarRecepcionOC, comentarOC } from '../actions'

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export interface OCDetalle {
  id: string
  numero_oc: string
  estado: string
  periodo: string
  fecha_emision: string
  fecha_entrega: string | null
  fecha_aprobacion: string | null
  fecha_envio: string | null
  fecha_recepcion: string | null
  valor_total: number | null
  observaciones: string | null
  proveedor: { nombre: string; telefono: string | null; email: string | null } | null
}
export interface OCItem {
  id: string
  cantidad_ped: number
  cantidad_rec: number
  precio_unit: number
  subtotal: number | null
  producto: { nombre_estandar: string; presentacion: string | null } | null
}
export interface OCEvento {
  id: string
  tipo: string
  estado_anterior: string | null
  estado_nuevo: string | null
  descripcion: string
  detalle: Record<string, unknown> | null
  usuario_nombre: string | null
  usuario_email: string | null
  created_at: string
}

const ESTADO_META: Record<string, { label: string; cls: string }> = {
  BORRADOR: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
  APROBADA: { label: 'Aprobada', cls: 'bg-indigo-100 text-indigo-700' },
  ENVIADA: { label: 'Comprada', cls: 'bg-blue-100 text-blue-700' },
  PARCIAL: { label: 'Recepción parcial', cls: 'bg-amber-100 text-amber-700' },
  COMPLETA: { label: 'Recibida', cls: 'bg-green-100 text-green-700' },
  ANULADA: { label: 'Anulada', cls: 'bg-red-100 text-red-700' },
}

const PASOS = [
  { estado: 'BORRADOR', label: 'Borrador', icon: FilePlus2 },
  { estado: 'APROBADA', label: 'Aprobada', icon: ClipboardCheck },
  { estado: 'ENVIADA', label: 'Comprada', icon: ShoppingCart },
  { estado: 'COMPLETA', label: 'Recibida', icon: PackageCheck },
]
const ORDEN: Record<string, number> = { BORRADOR: 0, APROBADA: 1, ENVIADA: 2, PARCIAL: 2, COMPLETA: 3 }

const EVENTO_ICON: Record<string, { icon: typeof Check; cls: string }> = {
  CREACION: { icon: FilePlus2, cls: 'bg-gray-100 text-gray-600' },
  CAMBIO_ESTADO: { icon: GitBranch, cls: 'bg-blue-100 text-blue-600' },
  EDICION: { icon: Pencil, cls: 'bg-amber-100 text-amber-600' },
  ITEM_AGREGADO: { icon: Plus, cls: 'bg-green-100 text-green-600' },
  ITEM_MODIFICADO: { icon: Pencil, cls: 'bg-amber-100 text-amber-600' },
  ITEM_ELIMINADO: { icon: Minus, cls: 'bg-red-100 text-red-600' },
  RECEPCION: { icon: PackageCheck, cls: 'bg-emerald-100 text-emerald-600' },
  COMENTARIO: { icon: MessageSquare, cls: 'bg-purple-100 text-purple-600' },
}

function fechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

export function OCDetalleClient({ oc, items, eventos }: { oc: OCDetalle; items: OCItem[]; eventos: OCEvento[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [comentario, setComentario] = useState('')
  const [recepcion, setRecepcion] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map(it => [it.id, Number(it.cantidad_rec)])),
  )

  const meta = ESTADO_META[oc.estado] ?? { label: oc.estado, cls: 'bg-gray-100 text-gray-600' }
  const pasoActual = ORDEN[oc.estado] ?? 0
  const anulada = oc.estado === 'ANULADA'
  const puedeRecibir = oc.estado === 'ENVIADA' || oc.estado === 'PARCIAL'

  const recibidoTotal = useMemo(() => items.reduce((a, it) => a + Number(it.cantidad_rec), 0), [items])
  const pedidoTotal = useMemo(() => items.reduce((a, it) => a + Number(it.cantidad_ped), 0), [items])

  function accion(fn: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn()
      if (r?.error) toast.error(r.error)
      else { toast.success(ok); router.refresh() }
    })
  }

  const registrar = () => {
    const cambios = items
      .filter(it => (recepcion[it.id] ?? 0) !== Number(it.cantidad_rec))
      .map(it => ({ itemId: it.id, cantidad: recepcion[it.id] ?? 0 }))
    if (cambios.length === 0) { toast.message('No hay cambios de recepción.'); return }
    accion(() => registrarRecepcionOC(oc.id, cambios), 'Recepción registrada.')
  }

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading font-bold text-xl text-gray-900 font-mono">{oc.numero_oc}</h1>
              <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${meta.cls}`}>{meta.label}</span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 font-body text-sm text-gray-600">
              <Building2 className="w-4 h-4 text-gray-400" /> {oc.proveedor?.nombre ?? 'Sin proveedor'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading font-bold text-2xl text-gray-900">{oc.valor_total ? cop.format(oc.valor_total) : '—'}</p>
            <p className="font-body text-xs text-gray-400">Emitida {new Date(oc.fecha_emision).toLocaleDateString('es-CO')}</p>
          </div>
        </div>

        {/* Stepper de proceso */}
        {anulada ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-red-700">
            <Ban className="w-4 h-4" /> <span className="font-body text-sm font-medium">Esta orden fue anulada.</span>
          </div>
        ) : (
          <div className="mt-5 flex items-center">
            {PASOS.map((p, i) => {
              const hecho = i < pasoActual
              const actual = i === pasoActual
              return (
                <div key={p.estado} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      hecho ? 'bg-brand-green text-white' : actual ? 'bg-brand-green/15 text-brand-green ring-2 ring-brand-green' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {hecho ? <Check className="w-4 h-4" /> : <p.icon className="w-4 h-4" />}
                    </div>
                    <span className={`mt-1 font-body text-[11px] ${actual ? 'text-brand-green font-semibold' : 'text-gray-500'}`}>{p.label}</span>
                  </div>
                  {i < PASOS.length - 1 && <div className={`h-0.5 flex-1 mx-1 -mt-4 ${i < pasoActual ? 'bg-brand-green' : 'bg-gray-200'}`} />}
                </div>
              )
            })}
          </div>
        )}

        {/* Fechas de proceso */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            { l: 'Aprobada', v: oc.fecha_aprobacion },
            { l: 'Comprada', v: oc.fecha_envio },
            { l: 'Entrega esperada', v: oc.fecha_entrega },
            { l: 'Recibida', v: oc.fecha_recepcion },
          ].map(f => (
            <div key={f.l} className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-gray-400">{f.l}</p>
              <p className="text-gray-700 font-medium">{f.v ? new Date(f.v).toLocaleDateString('es-CO') : '—'}</p>
            </div>
          ))}
        </div>

        {/* Acciones de flujo */}
        <div className="mt-4 flex flex-wrap gap-2">
          {oc.estado === 'BORRADOR' && (
            <button onClick={() => accion(() => avanzarEstadoOC(oc.id, 'APROBADA'), 'Orden aprobada.')} disabled={pending}
              className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">
              <ClipboardCheck className="w-4 h-4" /> Aprobar
            </button>
          )}
          {oc.estado === 'APROBADA' && (
            <button onClick={() => accion(() => avanzarEstadoOC(oc.id, 'ENVIADA'), 'Marcada como comprada.')} disabled={pending}
              className="flex items-center gap-2 bg-blue-600 text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <ShoppingCart className="w-4 h-4" /> Marcar como comprada / enviada
            </button>
          )}
          {!anulada && oc.estado !== 'COMPLETA' && (
            <button onClick={() => { if (confirm('¿Anular esta orden?')) accion(() => avanzarEstadoOC(oc.id, 'ANULADA'), 'Orden anulada.') }} disabled={pending}
              className="flex items-center gap-2 border border-red-200 text-red-600 font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-red-50 disabled:opacity-50">
              <Ban className="w-4 h-4" /> Anular
            </button>
          )}
          {pending && <Loader2 className="w-5 h-5 animate-spin text-gray-400 self-center" />}
        </div>
      </div>

      {/* Ítems */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2"><Truck className="w-4 h-4 text-brand-green" /> Ítems ({items.length})</h2>
          <span className="font-body text-xs text-gray-400">Recibido {recibidoTotal} / {pedidoTotal}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Producto</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Pedido</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Precio</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Subtotal</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Recibido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(it => {
                const rec = puedeRecibir ? (recepcion[it.id] ?? 0) : Number(it.cantidad_rec)
                const completo = Number(it.cantidad_rec) >= Number(it.cantidad_ped)
                return (
                  <tr key={it.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5">
                      <p className="font-body text-sm text-gray-800">{it.producto?.nombre_estandar ?? '—'}</p>
                      <p className="font-body text-xs text-gray-400">{it.producto?.presentacion}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-body text-sm text-gray-700">{Number(it.cantidad_ped)}</td>
                    <td className="px-4 py-2.5 text-right font-body text-sm text-gray-600">{cop.format(Number(it.precio_unit))}</td>
                    <td className="px-4 py-2.5 text-right font-body text-sm text-gray-900 font-semibold">{cop.format(Number(it.subtotal ?? Number(it.cantidad_ped) * Number(it.precio_unit)))}</td>
                    <td className="px-4 py-2.5 text-center">
                      {puedeRecibir ? (
                        <input type="number" min={0} max={Number(it.cantidad_ped)} value={rec}
                          onChange={(e) => setRecepcion(p => ({ ...p, [it.id]: Number(e.target.value) }))}
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right outline-none focus:border-brand-green" />
                      ) : (
                        <span className={`font-body text-sm ${completo ? 'text-green-600 font-semibold' : Number(it.cantidad_rec) > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {Number(it.cantidad_rec)} / {Number(it.cantidad_ped)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {puedeRecibir && (
          <div className="flex justify-end px-5 py-3 border-t border-gray-100">
            <button onClick={registrar} disabled={pending}
              className="flex items-center gap-2 bg-emerald-600 text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              <PackageCheck className="w-4 h-4" /> Registrar recepción
            </button>
          </div>
        )}
      </div>

      {/* Comentario */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-end gap-2">
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={1}
            placeholder="Agrega un comentario a la trazabilidad…"
            className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
          <button onClick={() => accion(async () => { const r = await comentarOC(oc.id, comentario); if (!r.error) setComentario(''); return r }, 'Comentario agregado.')}
            disabled={pending || !comentario.trim()}
            className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">
            <Send className="w-4 h-4" /> Comentar
          </button>
        </div>
      </div>

      {/* Trazabilidad / línea de tiempo */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2"><Clock className="w-4 h-4 text-brand-green" /> Trazabilidad</h2>
        </div>
        <ol className="p-4 space-y-1">
          {eventos.length === 0 && <p className="py-4 text-center font-body text-sm text-gray-400">Sin eventos.</p>}
          {eventos.map((e) => {
            const ic = EVENTO_ICON[e.tipo] ?? { icon: MessageSquare, cls: 'bg-gray-100 text-gray-600' }
            return (
              <li key={e.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${ic.cls}`}><ic.icon className="w-4 h-4" /></span>
                  <span className="w-px flex-1 bg-gray-100" />
                </div>
                <div className="pb-4 min-w-0 flex-1">
                  <p className="font-body text-sm text-gray-800">{e.descripcion}</p>
                  {e.detalle && Object.keys(e.detalle).length > 0 && (
                    <p className="font-body text-xs text-gray-500 mt-0.5 break-words">{resumenDetalle(e.detalle)}</p>
                  )}
                  <p className="font-body text-[11px] text-gray-400 mt-0.5">
                    {e.usuario_nombre ?? e.usuario_email ?? 'Sistema'} · {fechaHora(e.created_at)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

function resumenDetalle(d: Record<string, unknown>): string {
  const partes: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === 'object' && 'antes' in (v as object)) {
      const o = v as { antes: unknown; despues: unknown }
      partes.push(`${k}: ${o.antes} → ${o.despues}`)
    } else if (k === 'recibido_ahora') {
      partes.push(`recibido: ${(d.recibido_antes ?? 0)} → ${v} (de ${d.pedido})`)
    } else if (['cantidad', 'precio', 'producto'].includes(k) && typeof v !== 'object') {
      partes.push(`${k}: ${v}`)
    }
  }
  return partes.join(' · ')
}
