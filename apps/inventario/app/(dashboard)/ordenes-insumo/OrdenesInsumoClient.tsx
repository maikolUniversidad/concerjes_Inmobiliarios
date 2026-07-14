'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, ClipboardList, MapPin, ChevronRight, Package, Users, CheckCircle2, Clock } from 'lucide-react'
import type { EstadoOrdenInsumo } from '@/lib/types/database'

export interface OrdenRow {
  id: string
  numero: string
  estado: EstadoOrdenInsumo
  sede: string
  created_at: string
  despachado_at: string | null
  total_items: number
  alistados: number
  responsables: number
}

export const ESTADO_META: Record<EstadoOrdenInsumo, { label: string; cls: string }> = {
  PENDIENTE:       { label: 'Pendiente',       cls: 'bg-amber-100 text-amber-700' },
  EN_ALISTAMIENTO: { label: 'En alistamiento', cls: 'bg-blue-100 text-blue-700' },
  ALISTADO:        { label: 'Alistado',        cls: 'bg-indigo-100 text-indigo-700' },
  DESPACHADO:      { label: 'Despachado',      cls: 'bg-green-100 text-green-700' },
  ANULADA:         { label: 'Anulada',         cls: 'bg-gray-100 text-gray-500' },
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

type Tab = 'pendientes' | 'todas'

export function OrdenesInsumoClient({ ordenes, puedeCrear }: { ordenes: OrdenRow[]; puedeCrear: boolean }) {
  const [tab, setTab] = useState<Tab>('pendientes')

  const pendientes = useMemo(
    () => ordenes.filter((o) => ['PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'].includes(o.estado)),
    [ordenes],
  )
  const lista = tab === 'pendientes' ? pendientes : ordenes

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          <button onClick={() => setTab('pendientes')}
            className={`font-body font-semibold text-sm px-4 py-2 rounded-xl border transition-colors ${tab === 'pendientes' ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Pendientes ({pendientes.length})
          </button>
          <button onClick={() => setTab('todas')}
            className={`font-body font-semibold text-sm px-4 py-2 rounded-xl border transition-colors ${tab === 'todas' ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Todas ({ordenes.length})
          </button>
        </div>
        {puedeCrear && (
          <Link href="/ordenes-insumo/nuevo"
            className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors">
            <Plus className="w-4 h-4" /> Nueva orden
          </Link>
        )}
      </div>

      {lista.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center shadow-sm">
          <ClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-body text-sm text-gray-400">
            {tab === 'pendientes' ? 'No hay órdenes pendientes.' : 'Aún no hay órdenes de insumo.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((o) => {
            const meta = ESTADO_META[o.estado]
            const pct = o.total_items > 0 ? Math.round((o.alistados / o.total_items) * 100) : 0
            return (
              <Link key={o.id} href={`/ordenes-insumo/${o.id}`}
                className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-brand-green/40 hover:shadow transition-all group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-sm text-gray-900">{o.numero}</p>
                    <p className="font-body text-xs text-gray-500 truncate flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-brand-green shrink-0" /> {o.sede}
                    </p>
                  </div>
                  <span className={`shrink-0 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                </div>

                <div className="mt-3 flex items-center gap-3 font-body text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {o.total_items} ítems</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {o.responsables}</span>
                  <span className="inline-flex items-center gap-1">
                    {o.estado === 'DESPACHADO' ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {o.estado === 'DESPACHADO' ? fmt(o.despachado_at) : fmt(o.created_at)}
                  </span>
                </div>

                {o.estado !== 'DESPACHADO' && o.estado !== 'ANULADA' && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between font-body text-[11px] text-gray-400 mb-1">
                      <span>Alistado</span><span>{o.alistados}/{o.total_items}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-brand-green transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                <div className="mt-3 flex justify-end">
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-green transition-colors" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
