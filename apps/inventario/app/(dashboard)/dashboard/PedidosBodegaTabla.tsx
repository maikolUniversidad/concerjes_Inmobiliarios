'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User2, ArrowRight } from 'lucide-react'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

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

const despachada = (estado: string) => ['DESPACHADO', 'EN_RUTA', 'ENTREGADO'].includes(estado)

export function PedidosBodegaTabla({ pedidos, responsables }: {
  pedidos: PedidoFila[]
  responsables: Record<string, string[]>
}) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<string>('TODAS')

  const conteos = useMemo(() => {
    const c: Record<string, number> = { TODAS: pedidos.length }
    for (const p of pedidos) c[p.estado] = (c[p.estado] ?? 0) + 1
    return c
  }, [pedidos])

  const filtrados = useMemo(
    () => (filtro === 'TODAS' ? pedidos : pedidos.filter((p) => p.estado === filtro)),
    [pedidos, filtro],
  )

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

  const columnas: ColumnaTabla<PedidoFila>[] = [
    {
      id: 'numero', header: 'Orden', valor: (p) => p.numero, ancho: 'w-32', tarjeta: 'titulo',
      className: 'font-heading font-bold text-gray-900',
    },
    {
      id: 'sede', header: 'Sede', valor: (p) => p.sede ?? 'Sin sede', tarjeta: 'subtitulo',
      ancho: 'max-w-[200px]', className: 'truncate text-gray-600',
    },
    {
      id: 'responsable', header: 'Responsable', prioridad: 2, tarjeta: 'meta', ancho: 'max-w-[170px]',
      valor: (p) => (responsables[p.id] ?? []).join(', '),
      celda: (p) => {
        const resp = responsables[p.id] ?? []
        return resp.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5 font-body text-sm text-gray-700">
            <User2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span className="truncate">{resp[0]}{resp.length > 1 ? ` +${resp.length - 1}` : ''}</span>
          </span>
        ) : <span className="font-body text-xs text-gray-300">—</span>
      },
    },
    {
      id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
      valor: (p) => META[p.estado]?.label ?? p.estado,
      celda: (p) => {
        const m = META[p.estado] ?? { label: p.estado, color: 'bg-gray-100 text-gray-600' }
        return <span className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${m.color}`}>{m.label}</span>
      },
    },
    {
      id: 'falta', header: 'Falta', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (p) => (despachada(p.estado) ? 0 : p.total - p.listos),
      celda: (p) => {
        const falta = p.total - p.listos
        return despachada(p.estado)
          ? <span className="font-body text-xs text-gray-300">—</span>
          : <span className={'font-heading text-base font-bold ' + (falta > 0 ? 'text-amber-600' : 'text-gray-300')}>{falta}</span>
      },
    },
    {
      id: 'alistado', header: 'Alistado', align: 'right', tarjeta: 'meta',
      valor: (p) => `${p.listos}/${p.total}`, className: 'text-gray-700',
    },
    {
      id: 'avance', header: 'Avance', prioridad: 3, ancho: 'w-36', tarjeta: 'oculto', filtrable: false,
      valor: (p) => (despachada(p.estado) ? 100 : p.total > 0 ? Math.round((p.listos / p.total) * 100) : 0),
      copiaTexto: (p) => `${despachada(p.estado) ? 100 : p.total > 0 ? Math.round((p.listos / p.total) * 100) : 0}%`,
      celda: (p) => {
        const pct = p.total > 0 ? Math.round((p.listos / p.total) * 100) : 0
        const listo = despachada(p.estado)
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div className={'h-full rounded-full ' + (listo ? 'bg-green-500' : pct === 100 ? 'bg-teal-500' : 'bg-brand-green')}
                style={{ width: `${listo ? 100 : pct}%` }} />
            </div>
            <span className="w-9 text-right font-body text-xs text-gray-400">{listo ? '✓' : `${pct}%`}</span>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Pedidos en curso</h2>
        <Link href="/alistamiento" className="flex items-center gap-1 font-body text-xs font-semibold text-brand-green hover:underline whitespace-nowrap">
          Ir a Alistamiento <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2">
        {chip('TODAS', 'Todas')}
        {ORDEN.filter((e) => (conteos[e] ?? 0) > 0).map((e) => chip(e, META[e]?.label ?? e))}
      </div>

      <TablaEstandar
        id="dashboard-pedidos"
        titulo="Pedidos en curso"
        modulo="Inventario"
        entidad="ordenes_insumo"
        datos={filtrados}
        columnas={columnas}
        filaId={(p) => p.id}
        busqueda="Buscar por orden, sede o responsable…"
        filasPorPagina={POR_PAGINA}
        onFilaClick={(p) => router.push(`/ordenes-insumo/${p.id}`)}
        vacio={
          <p className="font-body text-sm text-gray-400">
            {pedidos.length === 0
              ? 'No hay pedidos en proceso en este momento.'
              : 'Ninguno coincide con el filtro o la búsqueda.'}
          </p>
        }
      />
    </div>
  )
}
