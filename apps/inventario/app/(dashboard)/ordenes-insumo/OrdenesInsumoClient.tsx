'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, ClipboardList, MapPin, ChevronRight, Package, Users, CheckCircle2, Clock, Filter, Search, X, AlertTriangle, CalendarClock, UserCircle2, BarChart3, ChevronDown, FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { EstadoOrdenInsumo } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { calcularUrgencia, fmtFecha } from './urgencia'
import { exportarOrdenesExcel, type ItemExport } from './exportarExcel'

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
  creador_id: string | null
  creador_nombre: string | null
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

// ── Reporte de órdenes por quién la creó (estado + conteo) ───────────────────
interface FilaReporte { id: string; nombre: string; total: number; porEstado: Record<string, number> }

function ReportePorCreador({ ordenes }: { ordenes: OrdenRow[] }) {
  const [abierto, setAbierto] = useState(false)

  const { filas, estadosPresentes } = useMemo(() => {
    const mapa = new Map<string, FilaReporte>()
    const estados = new Set<string>()
    for (const o of ordenes) {
      const id = o.creador_id ?? 'sin'
      const nombre = o.creador_nombre ?? 'Sin usuario'
      if (!mapa.has(id)) mapa.set(id, { id, nombre, total: 0, porEstado: {} })
      const f = mapa.get(id)!
      f.total += 1
      f.porEstado[o.estado] = (f.porEstado[o.estado] ?? 0) + 1
      estados.add(o.estado)
    }
    const filas = [...mapa.values()].sort((a, b) => b.total - a.total)
    // Estados ordenados según el orden lógico del catálogo.
    const orden = Object.keys(ESTADO_META)
    const estadosPresentes = [...estados].sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
    return { filas, estadosPresentes }
  }, [ordenes])

  if (ordenes.length === 0) return null

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <button onClick={() => setAbierto(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Reporte por creador</h2>
          <span className="font-body text-xs text-gray-400">{filas.length} usuario(s) · {ordenes.length} órdenes</span>
        </div>
        {abierto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {abierto && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Creado por</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-20">Total</th>
                {estadosPresentes.map((e) => (
                  <th key={e} className="text-center font-body font-semibold text-[10px] text-gray-500 uppercase px-2 py-2.5 whitespace-nowrap">
                    {metaEstado(e).label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filas.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-body text-sm text-gray-800">
                      <UserCircle2 className="w-4 h-4 text-gray-300 shrink-0" /> {f.nombre}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="font-heading font-bold text-sm text-brand-green">{f.total}</span>
                  </td>
                  {estadosPresentes.map((e) => (
                    <td key={e} className="px-2 py-2.5 text-center">
                      {f.porEstado[e]
                        ? <span className={`inline-block min-w-[22px] font-body text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${metaEstado(e).cls}`}>{f.porEstado[e]}</span>
                        : <span className="font-body text-xs text-gray-200">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50/70 border-t border-gray-100">
                <td className="px-4 py-2.5 font-body font-semibold text-sm text-gray-700">Total</td>
                <td className="px-3 py-2.5 text-center font-heading font-bold text-sm text-gray-900">{ordenes.length}</td>
                {estadosPresentes.map((e) => (
                  <td key={e} className="px-2 py-2.5 text-center font-body text-xs font-semibold text-gray-600">
                    {filas.reduce((s, f) => s + (f.porEstado[e] ?? 0), 0)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export function OrdenesInsumoClient({ ordenes, puedeCrear, estadoInicial }: {
  ordenes: OrdenRow[]; puedeCrear: boolean; estadoInicial?: string
}) {
  const estadoValido = estadoInicial && estadoInicial in ESTADO_META
    ? (estadoInicial as EstadoOrdenInsumo) : 'todos'
  // Primera vista: lo urgente por entregar, ordenado por fecha.
  const [tab, setTab] = useState<Tab>('entregar')
  const [filtroEstado, setFiltroEstado] = useState<EstadoOrdenInsumo | 'todos'>(estadoValido)
  const [showFiltro, setShowFiltro] = useState(false)
  const [filtroCreador, setFiltroCreador] = useState<string>('todos')
  const [showCreador, setShowCreador] = useState(false)
  const [q, setQ] = useState('')

  // Lista de creadores presentes (para el filtro "creado por").
  const creadores = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const o of ordenes) mapa.set(o.creador_id ?? 'sin', o.creador_nombre ?? 'Sin usuario')
    return [...mapa.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [ordenes])

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
    const porCreador = filtroCreador === 'todos' ? porEstado : porEstado.filter((o) => (o.creador_id ?? 'sin') === filtroCreador)
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    const filtrada = tokens.length === 0 ? porCreador : porCreador.filter((o) => {
      const heno = norm(`${o.numero} ${o.sede} ${o.creador_nombre ?? ''}`)
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
  }, [tab, proceso, porEntregar, ordenes, filtroEstado, filtroCreador, q])

  // ── Exportar a Excel lo que está filtrado en pantalla ──────────────────────
  const [exportando, setExportando] = useState(false)
  async function exportar() {
    if (lista.length === 0) { toast.info('No hay órdenes para exportar con los filtros actuales.'); return }
    setExportando(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any
      const ids = lista.map((o) => o.id)
      // Detalle de ítems de las órdenes filtradas (en lotes por si son muchas).
      const items: ItemExport[] = []
      for (let i = 0; i < ids.length; i += 120) {
        const chunk = ids.slice(i, i + 120)
        const { data, error } = await sb
          .from('orden_insumo_items')
          .select('orden_id, cantidad_solicitada, cantidad_alistada, es_adicional, producto:productos ( codigo, nombre_estandar, presentacion )')
          .in('orden_id', chunk)
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of ((data ?? []) as any[])) {
          items.push({
            orden_id: r.orden_id,
            codigo: r.producto?.codigo ?? null,
            nombre: r.producto?.nombre_estandar ?? '—',
            presentacion: r.producto?.presentacion ?? null,
            es_adicional: !!r.es_adicional,
            solicitado: Number(r.cantidad_solicitada ?? 0),
            alistado: Number(r.cantidad_alistada ?? 0),
          })
        }
      }
      const ctxTab = tab === 'entregar' ? 'Por entregar' : tab === 'proceso' ? 'Por procesar' : 'Todas'
      const ctxEstado = filtroEstado !== 'todos' ? ` · ${FILTROS_ESTADO.find((f) => f.value === filtroEstado)?.label ?? filtroEstado}` : ''
      const ctxCreador = filtroCreador !== 'todos' ? ` · ${creadores.find((c) => c.id === filtroCreador)?.nombre ?? ''}` : ''
      await exportarOrdenesExcel(lista, items, `${ctxTab}${ctxEstado}${ctxCreador} · ${lista.length} órdenes`)
      toast.success(`Excel generado con ${lista.length} órdenes.`)
    } catch {
      toast.error('No se pudo generar el Excel.')
    } finally {
      setExportando(false)
    }
  }

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

      {/* Reporte de órdenes por quién la creó (estado + conteo) */}
      <ReportePorCreador ordenes={ordenes} />

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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Exportar a Excel lo filtrado */}
          <button
            onClick={exportar}
            disabled={exportando}
            title="Descargar Excel con las órdenes filtradas (hojas: Órdenes, Ítems, Resumen)"
            className="inline-flex items-center gap-2 font-body font-semibold text-sm px-3 py-2 rounded-xl border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50">
            {exportando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            Excel ({lista.length})
          </button>
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
          {/* Filtro por creador (quién creó la orden) */}
          {creadores.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowCreador(v => !v)}
                className={`inline-flex items-center gap-2 font-body font-semibold text-sm px-3 py-2 rounded-xl border transition-colors ${filtroCreador !== 'todos' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                <UserCircle2 className="w-3.5 h-3.5" />
                <span className="max-w-[140px] truncate">{filtroCreador === 'todos' ? 'Creado por' : (creadores.find(c => c.id === filtroCreador)?.nombre ?? 'Creado por')}</span>
              </button>
              {showCreador && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[200px] max-h-72 overflow-y-auto">
                  <button onClick={() => { setFiltroCreador('todos'); setShowCreador(false) }}
                    className={`w-full text-left font-body text-sm px-4 py-2 hover:bg-gray-50 ${filtroCreador === 'todos' ? 'text-brand-green font-semibold' : 'text-gray-700'}`}>
                    Todos
                  </button>
                  {creadores.map(c => (
                    <button key={c.id}
                      onClick={() => { setFiltroCreador(c.id); setShowCreador(false) }}
                      className={`w-full text-left font-body text-sm px-4 py-2 hover:bg-gray-50 transition-colors ${filtroCreador === c.id ? 'text-brand-green font-semibold' : 'text-gray-700'}`}>
                      {c.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
                  {o.creador_nombre && (
                    <span className="inline-flex items-center gap-1" title="Creada por"><UserCircle2 className="w-3.5 h-3.5" /> {o.creador_nombre}</span>
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
