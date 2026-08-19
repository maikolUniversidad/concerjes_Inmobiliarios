'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  MapPin, ArrowRight, Truck, Search, PackageCheck, X, LayoutGrid, List,
  ClipboardCheck, Boxes, Clock, ListChecks, PackageOpen, User2, AlertTriangle,
} from 'lucide-react'

export interface Fila {
  id: string; numero: string; estado: string; created_at: string; aprobado_at: string | null
  sede: { nombre: string } | null
  items: { alistado: boolean; cantidad_solicitada: number; cantidad_alistada: number }[]
}

/** Ítems y unidades que quedaron sin enviar (solicitado − alistado). */
const pendienteEnvio = (o: Fila) => {
  let unidades = 0; let items = 0
  for (const i of o.items ?? []) {
    const p = Math.max(0, Number(i.cantidad_solicitada) - Number(i.cantidad_alistada))
    if (p > 0) { unidades += p; items++ }
  }
  return { unidades, items }
}
/** DESPACHADO pero se fue con productos pendientes. */
const despachoIncompleto = (o: Fila) => o.estado === 'DESPACHADO' && pendienteEnvio(o).items > 0

const META: Record<string, { label: string; color: string; chip: string }> = {
  APROBADA:        { label: 'Lista para alistar', color: 'bg-blue-100 text-blue-700',     chip: 'bg-blue-600' },
  EN_ALISTAMIENTO: { label: 'En alistamiento',    color: 'bg-violet-100 text-violet-700', chip: 'bg-violet-600' },
  ALISTADO:        { label: 'Alistado',           color: 'bg-teal-100 text-teal-700',     chip: 'bg-teal-600' },
  DESPACHADO:      { label: 'Despachado',         color: 'bg-green-100 text-green-700',   chip: 'bg-green-600' },
}
const ORDEN_ESTADOS = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO']

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const cuenta = (o: Fila) => {
  const total = o.items?.length ?? 0
  const listos = (o.items ?? []).filter((i) => i.alistado).length
  return { total, listos, falta: total - listos, pct: total > 0 ? Math.round((listos / total) * 100) : 0 }
}

type Vista = 'tarjetas' | 'tabla'

export function AlistamientoClient({ ordenes, responsables = {} }: {
  ordenes: Fila[]; responsables?: Record<string, string[]>
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<string>('PENDIENTES')
  const [vista, setVista] = useState<Vista>('tabla')

  // ── Resumen global de la bodega (todas las órdenes, no el filtro) ──────────
  const resumen = useMemo(() => {
    const r = { porAlistar: 0, enCurso: 0, listas: 0, itemsFalta: 0, itemsListos: 0 }
    for (const o of ordenes) {
      if (o.estado === 'APROBADA') r.porAlistar++
      else if (o.estado === 'EN_ALISTAMIENTO') r.enCurso++
      else if (o.estado === 'ALISTADO') r.listas++
      if (o.estado !== 'DESPACHADO') {
        const c = cuenta(o); r.itemsFalta += c.falta; r.itemsListos += c.listos
      }
    }
    return r
  }, [ordenes])

  const conteos = useMemo(() => {
    const c: Record<string, number> = { TODOS: ordenes.length, PENDIENTES: 0, CON_PENDIENTE: 0 }
    for (const o of ordenes) {
      c[o.estado] = (c[o.estado] ?? 0) + 1
      if (o.estado !== 'DESPACHADO') c.PENDIENTES++
      if (despachoIncompleto(o)) c.CON_PENDIENTE++
    }
    return c
  }, [ordenes])

  const filtradas = useMemo(() => {
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    return ordenes.filter((o) => {
      if (filtro === 'PENDIENTES' && o.estado === 'DESPACHADO') return false
      if (filtro === 'CON_PENDIENTE' && !despachoIncompleto(o)) return false
      if (filtro !== 'TODOS' && filtro !== 'PENDIENTES' && filtro !== 'CON_PENDIENTE' && o.estado !== filtro) return false
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
      {/* ── Cards de control de bodega ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Card label="Por alistar" value={resumen.porAlistar} sub="órdenes aprobadas" icon={ClipboardCheck} color="bg-blue-50 text-blue-600" onClick={() => setFiltro('APROBADA')} />
        <Card label="En alistamiento" value={resumen.enCurso} sub="en curso ahora" icon={Clock} color="bg-violet-50 text-violet-600" onClick={() => setFiltro('EN_ALISTAMIENTO')} />
        <Card label="Listas" value={resumen.listas} sub="alistadas, por despachar" icon={ListChecks} color="bg-teal-50 text-teal-600" onClick={() => setFiltro('ALISTADO')} />
        <Card label="Ítems por alistar" value={resumen.itemsFalta} sub="pendientes en bodega" icon={PackageOpen} color="bg-amber-50 text-amber-700" alerta={resumen.itemsFalta > 0} />
        <Card label="Ítems alistados" value={resumen.itemsListos} sub="ya preparados" icon={Boxes} color="bg-green-50 text-green-600" />
      </div>

      {/* Buscador + toggle de vista */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número o sede…"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-9 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20" />
          {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>}
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-white p-0.5">
          <button onClick={() => setVista('tabla')} title="Tabla"
            className={'rounded-lg p-2 ' + (vista === 'tabla' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-100')}><List className="h-4 w-4" /></button>
          <button onClick={() => setVista('tarjetas')} title="Tarjetas"
            className={'rounded-lg p-2 ' + (vista === 'tarjetas' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-100')}><LayoutGrid className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2">
        {chip('PENDIENTES', 'Por trabajar')}
        {chip('TODOS', 'Todas')}
        {(conteos.CON_PENDIENTE ?? 0) > 0 && (
          <button onClick={() => setFiltro('CON_PENDIENTE')}
            className={'inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-body text-xs font-semibold transition-colors ' +
              (filtro === 'CON_PENDIENTE' ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200')}>
            <AlertTriangle className="w-3.5 h-3.5" /> Con pendiente ({conteos.CON_PENDIENTE})
          </button>
        )}
        {ORDEN_ESTADOS.filter((e) => (conteos[e] ?? 0) > 0).map((e) => chip(e, META[e]?.label ?? e))}
      </div>

      {/* Resultados */}
      {filtradas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center text-gray-400">
          <PackageCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="font-heading text-lg font-bold text-gray-600">Sin resultados</p>
          <p className="mt-1 font-body text-sm">{q ? 'Ninguna orden coincide con tu búsqueda.' : 'No hay órdenes en este estado.'}</p>
        </div>
      ) : vista === 'tabla' ? (
        /* ── Tabla de control ── */
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Orden</th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Sede</th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Responsable</th>
                <th className="px-4 py-3 text-center font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                <th className="px-4 py-3 text-right font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Falta</th>
                <th className="px-4 py-3 text-right font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Alistado</th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500 w-40">Avance</th>
                <th className="px-4 py-3 text-center font-body text-xs font-semibold uppercase tracking-wide text-gray-500 w-28">Sin enviar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtradas.map((o) => {
                const c = cuenta(o)
                const m = META[o.estado] ?? { label: o.estado, color: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={o.id} onClick={() => router.push(`/ordenes-insumo/${o.id}`)}
                    className="cursor-pointer hover:bg-gray-50/70">
                    <td className="px-4 py-3 font-heading text-sm font-bold text-gray-900">{o.numero}</td>
                    <td className="px-4 py-3 font-body text-sm text-gray-600 max-w-[200px] truncate">{o.sede?.nombre ?? 'Sin sede'}</td>
                    <td className="px-4 py-3 max-w-[180px]">
                      {(responsables[o.id]?.length ?? 0) > 0 ? (
                        <span className="flex items-center gap-1.5 truncate font-body text-sm text-gray-700">
                          <User2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="truncate">
                            {responsables[o.id][0]}{responsables[o.id].length > 1 ? ` +${responsables[o.id].length - 1}` : ''}
                          </span>
                        </span>
                      ) : <span className="font-body text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${m.color}`}>{m.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={'font-heading text-base font-bold ' + (c.falta > 0 ? 'text-amber-600' : 'text-gray-300')}>{c.falta}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm text-gray-700">{c.listos}/{c.total}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className={'h-full rounded-full ' + (c.pct === 100 ? 'bg-teal-500' : 'bg-brand-green')} style={{ width: `${c.pct}%` }} />
                        </div>
                        <span className="w-9 text-right font-body text-xs text-gray-400">{c.pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {despachoIncompleto(o) ? (() => {
                        const p = pendienteEnvio(o)
                        return (
                          <span onClick={(e) => { e.stopPropagation(); router.push(`/ordenes-insumo/${o.id}`) }}
                            title="Se despachó con productos pendientes — clic para enviar lo restante"
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-body text-[11px] font-bold text-amber-700 cursor-pointer hover:bg-amber-200">
                            <AlertTriangle className="w-3 h-3" /> {p.items} ítem · {p.unidades}
                          </span>
                        )
                      })() : <span className="text-gray-200 text-xs">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Tarjetas ── */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((o) => {
            const m = META[o.estado] ?? { label: o.estado, color: 'bg-gray-100 text-gray-600' }
            const c = cuenta(o)
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
                {(responsables[o.id]?.length ?? 0) > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 truncate font-body text-xs text-gray-400">
                    <User2 className="h-3 w-3 shrink-0" /> {responsables[o.id][0]}{responsables[o.id].length > 1 ? ` +${responsables[o.id].length - 1}` : ''}
                  </p>
                )}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between font-body text-xs text-gray-500">
                    <span>{c.falta > 0 ? `Faltan ${c.falta}` : 'Completo'}</span><span>{c.listos}/{c.total} ítems</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
                {despachoIncompleto(o) && (() => {
                  const p = pendienteEnvio(o)
                  return (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-body text-[11px] font-bold text-amber-700">
                      <AlertTriangle className="w-3 h-3" /> Sin enviar: {p.items} ítem · {p.unidades} und
                    </p>
                  )
                })()}
                <span className="mt-3 flex items-center gap-1 font-body text-xs font-semibold text-brand-green">
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

function Card({ label, value, sub, icon: Icon, color, onClick, alerta }: {
  label: string; value: number; sub: string
  icon: React.ComponentType<{ className?: string }>; color: string; onClick?: () => void; alerta?: boolean
}) {
  const cls = 'rounded-2xl border border-gray-100 bg-white p-4 shadow-sm text-left transition-all ' + (onClick ? 'hover:border-brand-green/40 hover:shadow cursor-pointer' : '')
  const inner = (
    <>
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${color}`}><Icon className="h-4 w-4" /></div>
      <p className={'font-heading text-2xl font-bold ' + (alerta ? 'text-amber-600' : 'text-gray-900')}>{value.toLocaleString('es-CO')}</p>
      <p className="font-body text-xs font-semibold text-gray-700">{label}</p>
      <p className="font-body text-[11px] text-gray-400">{sub}</p>
    </>
  )
  return onClick ? <button onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>
}
