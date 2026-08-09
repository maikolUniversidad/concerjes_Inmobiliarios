'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User2, ArrowRight, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'

const POR_PAGINA = 8

export interface PedidoFila {
  id: string; numero: string; estado: string
  sede: string | null; total: number; listos: number
}

const META: Record<string, { label: string; color: string }> = {
  APROBADA:        { label: 'Por alistar',     color: 'bg-blue-100 text-blue-700' },
  EN_ALISTAMIENTO: { label: 'En alistamiento', color: 'bg-violet-100 text-violet-700' },
  ALISTADO:        { label: 'Alistado',        color: 'bg-teal-100 text-teal-700' },
  DESPACHADO:      { label: 'Despachado',      color: 'bg-green-100 text-green-700' },
  EN_RUTA:         { label: 'En ruta',         color: 'bg-sky-100 text-sky-700' },
  ENTREGADO:       { label: 'Entregado',       color: 'bg-emerald-100 text-emerald-800' },
}
// Orden lógico para los chips de filtro.
const ORDEN = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO', 'EN_RUTA', 'ENTREGADO']

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function PedidosBodegaTabla({ pedidos, responsables }: {
  pedidos: PedidoFila[]
  responsables: Record<string, string[]>
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<string>('TODAS')
  const [pagina, setPagina] = useState(1)

  const conteos = useMemo(() => {
    const c: Record<string, number> = { TODAS: pedidos.length }
    for (const p of pedidos) c[p.estado] = (c[p.estado] ?? 0) + 1
    return c
  }, [pedidos])

  const filtrados = useMemo(() => {
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    return pedidos.filter((p) => {
      if (filtro !== 'TODAS' && p.estado !== filtro) return false
      if (tokens.length === 0) return true
      const heno = norm(`${p.numero} ${p.sede ?? ''} ${(responsables[p.id] ?? []).join(' ')}`)
      return tokens.every((t) => heno.includes(t))
    })
  }, [pedidos, q, filtro, responsables])

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  useEffect(() => { setPagina(1) }, [q, filtro])   // al cambiar filtro/búsqueda, vuelve a la 1
  const paginaSegura = Math.min(pagina, totalPaginas)
  const visibles = filtrados.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA)
  const desde = filtrados.length === 0 ? 0 : (paginaSegura - 1) * POR_PAGINA + 1
  const hasta = Math.min(paginaSegura * POR_PAGINA, filtrados.length)

  const chip = (key: string, label: string) => {
    const activo = filtro === key
    return (
      <button key={key} onClick={() => setFiltro(key)}
        className={'rounded-full px-3 py-1 font-body text-xs font-semibold transition-colors ' +
          (activo ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
        {label} <span className={activo ? 'text-white/80' : 'text-gray-400'}>({conteos[key] ?? 0})</span>
      </button>
    )
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 flex-wrap">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Pedidos en curso</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
              className="w-44 sm:w-56 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-7 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20" />
            {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <Link href="/alistamiento" className="hidden sm:flex items-center gap-1 font-body text-xs font-semibold text-brand-green hover:underline whitespace-nowrap">
            Ir a Alistamiento <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-gray-50">
        {chip('TODAS', 'Todas')}
        {ORDEN.filter((e) => (conteos[e] ?? 0) > 0).map((e) => chip(e, META[e]?.label ?? e))}
      </div>

      {filtrados.length === 0 ? (
        <div className="px-5 py-12 text-center font-body text-sm text-gray-400">
          {pedidos.length === 0 ? 'No hay pedidos en proceso en este momento.' : 'Ninguno coincide con el filtro o la búsqueda.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-5 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Orden</th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Sede</th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Responsable</th>
                <th className="px-4 py-3 text-center font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                <th className="px-4 py-3 text-right font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Falta</th>
                <th className="px-4 py-3 text-right font-body text-xs font-semibold uppercase tracking-wide text-gray-500">Alistado</th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500 w-36">Avance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibles.map((p) => {
                const falta = p.total - p.listos
                const pct = p.total > 0 ? Math.round((p.listos / p.total) * 100) : 0
                const m = META[p.estado] ?? { label: p.estado, color: 'bg-gray-100 text-gray-600' }
                const resp = responsables[p.id] ?? []
                const despachada = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO'].includes(p.estado)
                return (
                  <tr key={p.id} onClick={() => router.push(`/ordenes-insumo/${p.id}`)}
                    className="cursor-pointer hover:bg-gray-50/70">
                    <td className="px-5 py-3 font-heading text-sm font-bold text-gray-900">{p.numero}</td>
                    <td className="px-4 py-3 font-body text-sm text-gray-600 max-w-[200px] truncate">{p.sede ?? 'Sin sede'}</td>
                    <td className="px-4 py-3 max-w-[170px]">
                      {resp.length > 0 ? (
                        <span className="flex items-center gap-1.5 truncate font-body text-sm text-gray-700">
                          <User2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="truncate">{resp[0]}{resp.length > 1 ? ` +${resp.length - 1}` : ''}</span>
                        </span>
                      ) : <span className="font-body text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${m.color}`}>{m.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {despachada
                        ? <span className="font-body text-xs text-gray-300">—</span>
                        : <span className={'font-heading text-base font-bold ' + (falta > 0 ? 'text-amber-600' : 'text-gray-300')}>{falta}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm text-gray-700">{p.listos}/{p.total}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className={'h-full rounded-full ' + (despachada ? 'bg-green-500' : pct === 100 ? 'bg-teal-500' : 'bg-brand-green')} style={{ width: `${despachada ? 100 : pct}%` }} />
                        </div>
                        <span className="w-9 text-right font-body text-xs text-gray-400">{despachada ? '✓' : `${pct}%`}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {filtrados.length > POR_PAGINA && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
          <p className="font-body text-xs text-gray-500">
            Mostrando <span className="font-semibold text-gray-700">{desde}–{hasta}</span> de {filtrados.length}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaSegura <= 1}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <span className="px-2 font-body text-xs text-gray-500">{paginaSegura} / {totalPaginas}</span>
            <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaSegura >= totalPaginas}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Siguiente <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
