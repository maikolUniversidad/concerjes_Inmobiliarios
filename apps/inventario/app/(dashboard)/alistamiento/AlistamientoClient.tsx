'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MapPin, ArrowRight, Truck, Search, PackageCheck, X } from 'lucide-react'

export interface Fila {
  id: string; numero: string; estado: string; created_at: string; aprobado_at: string | null
  sede: { nombre: string } | null
  items: { alistado: boolean }[]
}

const META: Record<string, { label: string; color: string; chip: string }> = {
  APROBADA:        { label: 'Lista para alistar', color: 'bg-blue-100 text-blue-700',     chip: 'bg-blue-600' },
  EN_ALISTAMIENTO: { label: 'En alistamiento',    color: 'bg-violet-100 text-violet-700', chip: 'bg-violet-600' },
  ALISTADO:        { label: 'Alistado',           color: 'bg-teal-100 text-teal-700',     chip: 'bg-teal-600' },
  DESPACHADO:      { label: 'Despachado',         color: 'bg-green-100 text-green-700',   chip: 'bg-green-600' },
}
const ORDEN_ESTADOS = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO']

// Búsqueda "inteligente": sin acentos, sin mayúsculas, por tokens (cada palabra
// escrita debe aparecer en algún lugar del texto, en cualquier orden).
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function AlistamientoClient({ ordenes }: { ordenes: Fila[] }) {
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<string>('PENDIENTES')

  const conteos = useMemo(() => {
    const c: Record<string, number> = { TODOS: ordenes.length, PENDIENTES: 0 }
    for (const o of ordenes) {
      c[o.estado] = (c[o.estado] ?? 0) + 1
      if (o.estado !== 'DESPACHADO') c.PENDIENTES++
    }
    return c
  }, [ordenes])

  const filtradas = useMemo(() => {
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    return ordenes.filter((o) => {
      if (filtro === 'PENDIENTES' && o.estado === 'DESPACHADO') return false
      if (filtro !== 'TODOS' && filtro !== 'PENDIENTES' && o.estado !== filtro) return false
      if (tokens.length === 0) return true
      const heno = norm(`${o.numero} ${o.sede?.nombre ?? ''}`)
      return tokens.every((t) => heno.includes(t))
    })
  }, [ordenes, q, filtro])

  const chip = (key: string, label: string) => {
    const activo = filtro === key
    const n = conteos[key] ?? 0
    return (
      <button key={key} onClick={() => setFiltro(key)}
        className={'rounded-full px-3 py-1.5 font-body text-xs font-semibold transition-colors ' +
          (activo ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
        {label} <span className={activo ? 'text-white/80' : 'text-gray-400'}>({n})</span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Buscador */}
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

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2">
        {chip('PENDIENTES', 'Por trabajar')}
        {chip('TODOS', 'Todas')}
        {ORDEN_ESTADOS.filter((e) => (conteos[e] ?? 0) > 0).map((e) => chip(e, META[e]?.label ?? e))}
      </div>

      {/* Resultados */}
      {filtradas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center text-gray-400">
          <PackageCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="font-heading text-lg font-bold text-gray-600">Sin resultados</p>
          <p className="mt-1 font-body text-sm">
            {q ? 'Ninguna orden coincide con tu búsqueda.' : 'No hay órdenes en este estado.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((o) => {
            const m = META[o.estado] ?? { label: o.estado, color: 'bg-gray-100 text-gray-600' }
            const total = o.items?.length ?? 0
            const listos = (o.items ?? []).filter((i) => i.alistado).length
            const pct = total > 0 ? Math.round((listos / total) * 100) : 0
            return (
              <Link key={o.id} href={`/ordenes-insumo/${o.id}`}
                className="group rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:border-brand-green/40 hover:shadow">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading text-base font-bold text-gray-900">{o.numero}</span>
                  <span className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${m.color}`}>{m.label}</span>
                </div>
                <p className="mt-1 flex items-center gap-1 truncate font-body text-xs text-gray-500">
                  <MapPin className="h-3 w-3 shrink-0" /> {o.sede?.nombre ?? 'Sin sede'}
                </p>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between font-body text-xs text-gray-500">
                    <span>Alistamiento</span><span>{listos}/{total} ítems</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 font-body text-xs font-semibold text-brand-green">
                  {o.estado === 'DESPACHADO'
                    ? <><Truck className="h-3.5 w-3.5" /> Ver despacho</>
                    : <>Abrir alistamiento <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
