'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User2, ArrowRight } from 'lucide-react'

export interface PedidoFila {
  id: string; numero: string; estado: string
  sede: string | null; total: number; listos: number
}

const META: Record<string, { label: string; color: string }> = {
  APROBADA:        { label: 'Por alistar',     color: 'bg-blue-100 text-blue-700' },
  EN_ALISTAMIENTO: { label: 'En alistamiento', color: 'bg-violet-100 text-violet-700' },
  ALISTADO:        { label: 'Alistado',        color: 'bg-teal-100 text-teal-700' },
}

export function PedidosBodegaTabla({ pedidos, responsables }: {
  pedidos: PedidoFila[]
  responsables: Record<string, string[]>
}) {
  const router = useRouter()

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Pedidos en bodega</h2>
        <Link href="/alistamiento" className="flex items-center gap-1 font-body text-xs font-semibold text-brand-green hover:underline">
          Ir a Alistamiento <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {pedidos.length === 0 ? (
        <div className="px-5 py-12 text-center font-body text-sm text-gray-400">
          No hay pedidos en proceso de alistamiento en este momento.
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
              {pedidos.map((p) => {
                const falta = p.total - p.listos
                const pct = p.total > 0 ? Math.round((p.listos / p.total) * 100) : 0
                const m = META[p.estado] ?? { label: p.estado, color: 'bg-gray-100 text-gray-600' }
                const resp = responsables[p.id] ?? []
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
                      <span className={'font-heading text-base font-bold ' + (falta > 0 ? 'text-amber-600' : 'text-gray-300')}>{falta}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm text-gray-700">{p.listos}/{p.total}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className={'h-full rounded-full ' + (pct === 100 ? 'bg-teal-500' : 'bg-brand-green')} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-9 text-right font-body text-xs text-gray-400">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
