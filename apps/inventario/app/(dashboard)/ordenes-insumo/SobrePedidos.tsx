'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ChevronRight, PackageX, ExternalLink } from 'lucide-react'

export interface OrdenDemanda { orden_id: string; numero: string; estado: string; sede: string | null; cantidad: number }
export interface ProductoSobrePedido {
  producto_id: string; nombre: string; presentacion: string | null
  stock_real: number; comprometido: number; disponible: number
  ordenes: OrdenDemanda[]
}

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador', EN_REVISION: 'En revisión', CAMBIOS_SOLICITADOS: 'Cambios', APROBADA: 'Aprobada',
  PENDIENTE: 'Pendiente', EN_ALISTAMIENTO: 'Alistando', ALISTADO: 'Alistado', DESPACHADO: 'Despachado', ANULADA: 'Anulada',
}

export function SobrePedidos({ items }: { items: ProductoSobrePedido[] }) {
  const [abierto, setAbierto] = useState(true)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())

  if (items.length === 0) return null

  function toggle(id: string) {
    setExpandido(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/50 shadow-sm overflow-hidden">
      <button onClick={() => setAbierto(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-red-50">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          <h2 className="font-heading font-semibold text-sm">Productos sobre-pedidos</h2>
          <span className="rounded-full bg-red-600 px-2 py-0.5 font-body text-[11px] font-bold text-white">{items.length}</span>
          <span className="font-body text-xs text-red-500/80 hidden sm:inline">se pidió más de lo que hay en órdenes en cola</span>
        </div>
        {abierto ? <ChevronDown className="w-4 h-4 text-red-400" /> : <ChevronRight className="w-4 h-4 text-red-400" />}
      </button>

      {abierto && (
        <div className="divide-y divide-red-100 border-t border-red-100">
          {items.map(p => {
            const open = expandido.has(p.producto_id)
            return (
              <div key={p.producto_id} className="bg-white/70">
                <button onClick={() => toggle(p.producto_id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-red-50/40">
                  <PackageX className="w-4 h-4 text-red-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-medium text-gray-900 truncate">{p.nombre}</p>
                    {p.presentacion && <p className="font-body text-[11px] text-gray-400">{p.presentacion}</p>}
                  </div>
                  <div className="hidden sm:flex items-center gap-4 shrink-0 font-body text-xs">
                    <span className="text-gray-500">Stock <span className="font-semibold text-gray-700">{p.stock_real}</span></span>
                    <span className="text-gray-500">Pedido <span className="font-semibold text-gray-700">{p.comprometido}</span></span>
                  </div>
                  <span className="shrink-0 rounded-lg bg-red-100 px-2 py-1 font-heading font-bold text-sm text-red-700" title="Faltante proyectado">
                    {p.disponible}
                  </span>
                  {open ? <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />}
                </button>

                {open && (
                  <div className="px-4 pb-3 pl-11">
                    <p className="mb-1 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">Órdenes en cola que lo piden</p>
                    <div className="space-y-1">
                      {p.ordenes.map(o => (
                        <Link key={o.orden_id} href={`/ordenes-insumo/${o.orden_id}`}
                          className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-1.5 hover:border-brand-green transition-colors">
                          <span className="font-mono text-xs text-brand-green">{o.numero}</span>
                          <span className="font-body text-xs text-gray-500 truncate flex-1">{o.sede ?? '—'}</span>
                          <span className="font-body text-[10px] text-gray-400 uppercase">{ESTADO_LABEL[o.estado] ?? o.estado}</span>
                          <span className="font-body text-xs font-semibold text-gray-700">{o.cantidad}</span>
                          <ExternalLink className="w-3 h-3 text-gray-300" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
