'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, ClipboardList, MapPin, ChevronRight, Package, Users, CheckCircle2, Clock, Filter, Search, X, AlertTriangle, CalendarClock } from 'lucide-react'
import type { EstadoOrdenInsumo } from '@/lib/types/database'
import { calcularUrgencia, fmtFecha } from './urgencia'

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
  fecha_entrega_pactada: string | null
  urgente: boolean
}

export const ESTADO_META: Record<EstadoOrdenInsumo, { label: string; cls: string }> = {
  BORRADOR:            { label: 'Borrador',            cls: 'bg-gray-100 text-gray-600' },
  EN_REVISION:         { label: 'En revisión',         cls: 'bg-blue-100 text-blue-700' },
  CAMBIOS_SOLICITADOS: { label: 'Cambios solicitados', cls: 'bg-amber-100 text-amber-800' },
  APROBADA:            { label: 'Aprobada',            cls: 'bg-teal-100 text-teal-700' },
  PENDIENTE:       { label: 'Pendiente',       cls: 'bg-amber-100 text-amber-700' },
  EN_ALISTAMIENTO: { label: 'En alistamiento', cls: 'bg-blue-100 text-blue-700' },
  ALISTADO:        { label: 'Alistado',        cls: 'bg-indigo-100 text-indigo-700' },
  DESPACHADO:      { label: 'Enviado',         cls: 'bg-green-100 text-green-700' },
  EN_RUTA:         { label: 'En ruta',         cls: 'bg-sky-100 text-sky-700' },
  ENTREGADO:       { label: 'Entregado',       cls: 'bg-teal-100 text-teal-700' },
  RECIBIDO:        { label: 'Recibido',        cls: 'bg-emerald-100 text-emerald-800' },
  ANULADA:         { label: 'Anulada',         cls: 'bg-gray-100 text-gray-500' },
}

/** Metadatos del estado con respaldo: nunca revienta si llega un estado nuevo. */
export function metaEstado(estado: string): { label: string; cls: string } {
  return ESTADO_META[estado as EstadoOrdenInsumo] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' }
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Búsqueda "inteligente": sin acentos/mayúsculas, por tokens (cada palabra debe
// aparecer, en cualquier orden).
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Tab = 'entregar' | 'proceso' | 'todas'

const ESTADOS_PROCESO: EstadoOrdenInsumo[] = ['APROBADA', 'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO']
// "Por entregar" = todo lo que sigue en curso hacia la sede (no recibido ni anulado).
const ESTADOS_CERRADOS: string[] = ['RECIBIDO', 'ANULADA']

const FILTROS_ESTADO: { value: EstadoOrdenInsumo | 'todos'; label: string }[] = [
  { value: 'todos',            label: 'Todos'            },
  { value: 'BORRADOR',         label: 'Borrador'         },
  { value: 'EN_REVISION',      label: 'En revisión'      },
  { value: 'APROBADA',         label: 'Aprobada'         },
  { value: 'PENDIENTE',        label: 'Pendiente'        },
  { value: 'EN_ALISTAMIENTO',  label: 'En alistamiento'  },
  { value: 'ALISTADO',         label: 'Alistado'         },
  { value: 'DESPACHADO',       label: 'Enviado'          },
  { value: 'EN_RUTA',          label: 'En ruta'          },
  { value: 'ENTREGADO',        label: 'Entregado'        },
  { value: 'RECIBIDO',         label: 'Recibido'         },
  { value: 'ANULADA',          label: 'Anulada'          },
]

export function OrdenesInsumoClient({ ordenes, puedeCrear, estadoInicial }: {
  ordenes: OrdenRow[]; puedeCrear: boolean; estadoInicial?: string
}) {
  const estadoValido = estadoInicial && estadoInicial in ESTADO_META
    ? (estadoInicial as EstadoOrdenInsumo) : 'todos'
  // Primera vista: lo urgente por entregar, ordenado por fecha.
  const [tab, setTab] = useState<Tab>('entregar')
  const [filtroEstado, setFiltroEstado] = useState<EstadoOrdenInsumo | 'todos'>(estadoValido)
  const [showFiltro, setShowFiltro] = useState(false)
  const [q, setQ] = useState('')

  const proceso = useMemo(
    () => ordenes.filter((o) => (ESTADOS_PROCESO as string[]).includes(o.estado)),
    [ordenes],
  )
  const porEntregar = useMemo(
    () => ordenes.filter((o) => !ESTADOS_CERRADOS.includes(o.estado)),
    [ordenes],
  )
  // Cuántas están urgentes/vencidas (para el aviso del tab).
  const urgentesCount = useMemo(
    () => porEntregar.filter((o) => calcularUrgencia(o).rank <= 2).length,
    [porEntregar],
  )

  const lista = useMemo(() => {
    const base = tab === 'proceso' ? proceso : tab === 'entregar' ? porEntregar : ordenes
    const porEstado = filtroEstado === 'todos' ? base : base.filter((o) => o.estado === filtroEstado)
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    const filtrada = tokens.length === 0 ? porEstado : porEstado.filter((o) => {
      const heno = norm(`${o.numero} ${o.sede}`)
      return tokens.every((t) => heno.includes(t))
    })
    // En "Por entregar" se ordena por urgencia (vencidas primero), luego por
    // fecha pactada más próxima y por más recientes.
    if (tab !== 'entregar') return filtrada
    return [...filtrada].sort((a, b) => {
      const ra = calcularUrgencia(a).rank, rb = calcularUrgencia(b).rank
      if (ra !== rb) return ra - rb
      const fa = a.fecha_entrega_pactada ?? '9999-12-31'
      const fb = b.fecha_entrega_pactada ?? '9999-12-31'
      if (fa !== fb) return fa < fb ? -1 : 1
      return a.created_at < b.created_at ? 1 : -1
    })
  }, [tab, proceso, porEntregar, ordenes, filtroEstado, q])

  return (
    <div className="space-y-4">
      {/* Buscador inteligente por número o sede */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por número o sede…"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-9 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setTab('entregar')}
            className={`inline-flex items-center gap-1.5 font-body font-semibold text-sm px-4 py-2 rounded-xl border transition-colors ${tab === 'entregar' ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            <CalendarClock className="w-3.5 h-3.5" /> Por entregar ({porEntregar.length})
            {urgentesCount > 0 && (
              <span className={`ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === 'entregar' ? 'bg-white/25 text-white' : 'bg-red-100 text-red-700'}`}>
                <AlertTriangle className="w-2.5 h-2.5" /> {urgentesCount}
              </span>
            )}
          </button>
          <button onClick={() => setTab('proceso')}
            className={`font-body font-semibold text-sm px-4 py-2 rounded-xl border transition-colors ${tab === 'proceso' ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Por procesar ({proceso.length})
          </button>
          <button onClick={() => setTab('todas')}
            className={`font-body font-semibold text-sm px-4 py-2 rounded-xl border transition-colors ${tab === 'todas' ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Todas ({ordenes.length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Filtro por estado */}
          <div className="relative">
            <button
              onClick={() => setShowFiltro(v => !v)}
              className={`inline-flex items-center gap-2 font-body font-semibold text-sm px-3 py-2 rounded-xl border transition-colors ${filtroEstado !== 'todos' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Filter className="w-3.5 h-3.5" />
              {filtroEstado === 'todos' ? 'Estado' : (FILTROS_ESTADO.find(f => f.value === filtroEstado)?.label ?? filtroEstado)}
            </button>
            {showFiltro && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[160px]">
                {FILTROS_ESTADO.map(f => (
                  <button key={f.value}
                    onClick={() => { setFiltroEstado(f.value); setShowFiltro(false) }}
                    className={`w-full text-left font-body text-sm px-4 py-2 hover:bg-gray-50 transition-colors ${filtroEstado === f.value ? 'text-brand-green font-semibold' : 'text-gray-700'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {puedeCrear && (
            <Link href="/ordenes-insumo/nuevo"
              className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors">
              <Plus className="w-4 h-4" /> Nueva orden
            </Link>
          )}
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center shadow-sm">
          <ClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-body text-sm text-gray-400">
            {q ? 'Ninguna orden coincide con tu búsqueda.'
              : tab === 'entregar' ? 'No hay órdenes pendientes por entregar.'
              : tab === 'proceso' ? 'No hay órdenes por procesar.'
              : filtroEstado !== 'todos' ? 'No hay órdenes con ese estado.'
              : 'Aún no hay órdenes de insumo.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((o) => {
            const meta = metaEstado(o.estado)
            const urg = calcularUrgencia(o)
            const pct = o.total_items > 0 ? Math.round((o.alistados / o.total_items) * 100) : 0
            // Borde de acento para lo más urgente.
            const acento = urg.nivel === 'VENCIDA' ? 'border-red-300' : urg.nivel === 'HOY' ? 'border-orange-300' : urg.nivel === 'URGENTE' ? 'border-amber-300' : 'border-gray-100'
            return (
              <Link key={o.id} href={`/ordenes-insumo/${o.id}`}
                className={`bg-white border rounded-2xl p-4 shadow-sm hover:border-brand-green/40 hover:shadow transition-all group ${acento}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-sm text-gray-900">{o.numero}</p>
                    <p className="font-body text-xs text-gray-500 truncate flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-brand-green shrink-0" /> {o.sede}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                    {urg.label && (
                      <span className={`inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${urg.cls}`}>
                        {urg.rank <= 1 && <AlertTriangle className="w-2.5 h-2.5" />}{urg.label}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 font-body text-xs text-gray-500 flex-wrap">
                  <span className="inline-flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {o.total_items} ítems</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {o.responsables}</span>
                  <span className="inline-flex items-center gap-1">
                    {o.estado === 'DESPACHADO' ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {o.estado === 'DESPACHADO' ? fmt(o.despachado_at) : fmt(o.created_at)}
                  </span>
                  {o.fecha_entrega_pactada && (
                    <span className="inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Entrega {fmtFecha(o.fecha_entrega_pactada)}</span>
                  )}
                </div>

                {!['DESPACHADO', 'RECIBIDO', 'ANULADA'].includes(o.estado) && (
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
