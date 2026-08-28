'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, ClipboardList, MapPin, ChevronRight, Package, Users, CheckCircle2, Clock, Filter, AlertTriangle, CalendarClock, UserCircle2, BarChart3, ChevronDown, FileSpreadsheet, Loader2, MessageSquare, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import type { EstadoOrdenInsumo } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { traerTodoPorIds } from '@/lib/supabase/paginado'
import { calcularUrgencia, fmtFecha } from './urgencia'
import { exportarOrdenesExcel, type ItemExport } from './exportarExcel'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

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
  /** Novedad escrita al crear el pedido (`ordenes_insumo.observacion`). */
  observacion: string | null
  /** Comentarios de la trazabilidad (eventos tipo COMENTARIO). */
  comentarios: number
  ultimo_comentario: string | null
  comentario_autor: string | null
}

/** Una orden "tiene comentarios" si trae novedad del pedido o comentarios en la trazabilidad. */
export function tieneComentarios(o: OrdenRow): boolean {
  return Boolean(o.observacion) || o.comentarios > 0
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

type FiltroComentario = 'todos' | 'con' | 'sin'

const FILTROS_COMENTARIO: { value: FiltroComentario; label: string }[] = [
  { value: 'todos', label: 'Todas'            },
  { value: 'con',   label: 'Con comentarios'  },
  { value: 'sin',   label: 'Sin comentarios'  },
]

/** Texto plano de la columna de comentarios: alimenta búsqueda, filtro y copiado. */
function textoComentarios(o: OrdenRow): string {
  const partes: string[] = []
  if (o.observacion) partes.push(`Novedad: ${o.observacion}`)
  if (o.ultimo_comentario) {
    partes.push(`${o.comentario_autor ? `${o.comentario_autor}: ` : ''}${o.ultimo_comentario}`)
  }
  if (!partes.length) return ''
  return o.comentarios > 1 ? `${partes.join(' · ')} (${o.comentarios} comentarios)` : partes.join(' · ')
}

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

  const columnasReporte: ColumnaTabla<FilaReporte>[] = [
    {
      id: 'nombre', header: 'Creado por', valor: (f) => f.nombre, ancho: 'min-w-[200px]', tarjeta: 'titulo',
      celda: (f) => (
        <span className="inline-flex items-center gap-1.5 font-body text-sm text-gray-800">
          <UserCircle2 className="w-4 h-4 text-gray-300 shrink-0" /> {f.nombre}
        </span>
      ),
    },
    {
      id: 'total', header: 'Total', valor: (f) => f.total, align: 'center', ancho: 'w-20', tarjeta: 'badge',
      celda: (f) => <span className="font-heading font-bold text-sm text-brand-green">{f.total}</span>,
    },
    ...estadosPresentes.map((e): ColumnaTabla<FilaReporte> => ({
      id: e,
      header: metaEstado(e).label,
      valor: (f) => f.porEstado[e] ?? 0,
      align: 'center',
      prioridad: 2,
      tarjeta: 'meta',
      celda: (f) => f.porEstado[e]
        ? <span className={`inline-block min-w-[22px] font-body text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${metaEstado(e).cls}`}>{f.porEstado[e]}</span>
        : <span className="font-body text-xs text-gray-200">·</span>,
    })),
  ]

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
        <div className="border-t border-gray-100 p-4">
          <TablaEstandar
            id="ordenes-reporte-creador"
            titulo="Órdenes por creador"
            modulo="Inventario"
            entidad="ordenes_insumo"
            datos={filas}
            columnas={columnasReporte}
            filaId={(f) => f.id}
            busqueda="Buscar usuario…"
            filasPorPagina={0}
            pie={(fs) => ({
              nombre: 'Total',
              total: <span className="font-heading font-bold text-gray-900">{fs.reduce((a, f) => a + f.total, 0)}</span>,
              ...Object.fromEntries(estadosPresentes.map((e) => [
                e, fs.reduce((acc, f) => acc + (f.porEstado[e] ?? 0), 0),
              ])),
            })}
          />
        </div>
      )}
    </div>
  )
}

export function OrdenesInsumoClient({ ordenes, puedeCrear, estadoInicial }: {
  ordenes: OrdenRow[]; puedeCrear: boolean; estadoInicial?: string
}) {
  const router = useRouter()
  const estadoValido = estadoInicial && estadoInicial in ESTADO_META
    ? (estadoInicial as EstadoOrdenInsumo) : 'todos'
  // Primera vista: lo urgente por entregar, ordenado por fecha.
  const [tab, setTab] = useState<Tab>('entregar')
  const [filtroEstado, setFiltroEstado] = useState<EstadoOrdenInsumo | 'todos'>(estadoValido)
  const [showFiltro, setShowFiltro] = useState(false)
  const [filtroCreador, setFiltroCreador] = useState<string>('todos')
  const [showCreador, setShowCreador] = useState(false)
  const [filtroComentario, setFiltroComentario] = useState<FiltroComentario>('todos')
  const [showComentario, setShowComentario] = useState(false)

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
    const filtrada = filtroComentario === 'todos'
      ? porCreador
      : porCreador.filter((o) => (filtroComentario === 'con' ? tieneComentarios(o) : !tieneComentarios(o)))
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
  }, [tab, proceso, porEntregar, ordenes, filtroEstado, filtroCreador, filtroComentario])

  // Cuántas de las que se ven traen novedad o comentarios (va en el botón del filtro).
  const conComentarios = useMemo(() => {
    const base = tab === 'proceso' ? proceso : tab === 'entregar' ? porEntregar : ordenes
    return base.filter(tieneComentarios).length
  }, [tab, proceso, porEntregar, ordenes])

  // ── Exportar a Excel lo que está filtrado en pantalla ──────────────────────
  const [exportando, setExportando] = useState(false)
  async function exportar() {
    if (lista.length === 0) { toast.info('No hay órdenes para exportar con los filtros actuales.'); return }
    setExportando(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any
      const ids = lista.map((o) => o.id)
      // Detalle de ítems de las órdenes filtradas. Va por lotes de órdenes Y
      // paginado dentro de cada lote: 120 órdenes son ~2.600 ítems y PostgREST
      // corta en 1.000 filas, así que sin `.range()` el Excel salía incompleto.
      const items: ItemExport[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filas = await traerTodoPorIds<any>(ids, (lote, desde, hasta) =>
        sb
          .from('orden_insumo_items')
          .select('orden_id, cantidad_solicitada, cantidad_alistada, es_adicional, producto:productos ( codigo, nombre_estandar, presentacion )')
          .in('orden_id', lote)
          .order('id', { ascending: true })
          .range(desde, hasta),
        { tamanoLote: 120, etiqueta: 'No se pudo leer el detalle de las órdenes' },
      )
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of filas as any[]) {
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
      const ctxComentario = filtroComentario !== 'todos' ? ` · ${FILTROS_COMENTARIO.find((f) => f.value === filtroComentario)?.label ?? ''}` : ''
      await exportarOrdenesExcel(lista, items, `${ctxTab}${ctxEstado}${ctxCreador}${ctxComentario} · ${lista.length} órdenes`)
      toast.success(`Excel generado con ${lista.length} órdenes.`)
    } catch {
      toast.error('No se pudo generar el Excel.')
    } finally {
      setExportando(false)
    }
  }

  const columnas: ColumnaTabla<OrdenRow>[] = [
    {
      id: 'numero', header: 'Número', valor: o => o.numero, tarjeta: 'titulo', ancho: 'w-36',
      celda: o => (
        <Link href={`/ordenes-insumo/${o.id}`} onClick={e => e.stopPropagation()}
          className="font-heading font-bold text-sm text-gray-900 hover:text-brand-green">
          {o.numero}
        </Link>
      ),
    },
    {
      id: 'sede', header: 'Sede', valor: o => o.sede, ancho: 'min-w-[220px]', tarjeta: 'subtitulo',
      celda: o => (
        <span className="font-body text-sm text-gray-600 flex items-center gap-1">
          <MapPin className="w-3 h-3 text-brand-green shrink-0" />
          <span className="truncate max-w-[280px]" title={o.sede}>{o.sede}</span>
        </span>
      ),
    },
    {
      id: 'estado', header: 'Estado', valor: o => metaEstado(o.estado).label, align: 'center', tarjeta: 'badge',
      celda: o => {
        const meta = metaEstado(o.estado)
        return <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
      },
    },
    {
      id: 'urgencia', header: 'Urgencia', align: 'center', prioridad: 2, tarjeta: 'badge',
      valor: o => calcularUrgencia(o).label ?? '',
      celda: o => {
        const urg = calcularUrgencia(o)
        return urg.label
          ? <span className={`inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${urg.cls}`}>
              {urg.rank <= 1 && <AlertTriangle className="w-2.5 h-2.5" />}{urg.label}
            </span>
          : <span className="text-gray-200">—</span>
      },
    },
    { id: 'items', header: 'Ítems', valor: o => o.total_items, align: 'right', prioridad: 2, tarjeta: 'meta' },
    {
      id: 'alistado', header: 'Alistado', align: 'right', prioridad: 3, tarjeta: 'meta',
      valor: o => `${o.alistados}/${o.total_items}`,
    },
    { id: 'responsables', header: 'Resp.', valor: o => o.responsables, align: 'right', prioridad: 3, tarjeta: 'oculto' },
    {
      id: 'creada', header: 'Creada', valor: o => fmt(o.created_at), prioridad: 2,
      className: 'whitespace-nowrap text-xs text-gray-400', tarjeta: 'meta',
    },
    {
      id: 'entrega', header: 'Entrega', prioridad: 2, tarjeta: 'meta',
      valor: o => (o.fecha_entrega_pactada ? fmtFecha(o.fecha_entrega_pactada) : ''),
      className: 'whitespace-nowrap text-xs text-gray-500',
    },
    {
      id: 'creador', header: 'Creada por', valor: o => o.creador_nombre ?? '', prioridad: 3,
      className: 'text-xs text-gray-500', tarjeta: 'meta',
    },
    {
      // Novedad del pedido + comentarios de la trazabilidad, en una sola columna.
      id: 'comentarios', header: 'Comentarios', prioridad: 2, ancho: 'min-w-[240px]', tarjeta: 'cuerpo',
      valor: o => textoComentarios(o),
      celda: o => {
        if (!tieneComentarios(o)) return <span className="text-gray-200">—</span>
        const resumen = o.ultimo_comentario ?? o.observacion ?? ''
        return (
          <span className="flex items-center gap-1.5 min-w-0" title={textoComentarios(o)}>
            {o.observacion
              ? <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              : <MessageSquare className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
            <span className="truncate max-w-[220px] font-body text-xs text-gray-600">{resumen}</span>
            {o.comentarios > 0 && (
              <span className="shrink-0 font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {o.comentarios}
              </span>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      {/* Reporte de órdenes por quién la creó (estado + conteo).
          Usa la lista YA filtrada (tab + estado + creador + búsqueda) para que
          los filtros de pantalla también afecten el reporte. */}
      <ReportePorCreador ordenes={lista} />

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
          {/* Filtro por comentarios: novedad del pedido o comentarios de la trazabilidad */}
          <div className="relative">
            <button
              onClick={() => setShowComentario(v => !v)}
              title="Ver solo las órdenes que tienen novedad o comentarios"
              className={`inline-flex items-center gap-2 font-body font-semibold text-sm px-3 py-2 rounded-xl border transition-colors ${filtroComentario !== 'todos' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <MessageSquare className="w-3.5 h-3.5" />
              {filtroComentario === 'todos' ? 'Comentarios' : (FILTROS_COMENTARIO.find(f => f.value === filtroComentario)?.label ?? 'Comentarios')}
              <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${filtroComentario !== 'todos' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                {conComentarios}
              </span>
            </button>
            {showComentario && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px]">
                {FILTROS_COMENTARIO.map(f => (
                  <button key={f.value}
                    onClick={() => { setFiltroComentario(f.value); setShowComentario(false) }}
                    className={`w-full text-left font-body text-sm px-4 py-2 hover:bg-gray-50 transition-colors ${filtroComentario === f.value ? 'text-brand-green font-semibold' : 'text-gray-700'}`}>
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

      <TablaEstandar
        id="ordenes-insumo"
        titulo="Órdenes de insumo"
        modulo="Inventario"
        entidad="ordenes_insumo"
        datos={lista}
        columnas={columnas}
        filaId={o => o.id}
        onFilaClick={o => router.push(`/ordenes-insumo/${o.id}`)}
        anchoAcciones="w-28"
        busqueda="Buscar por número, sede o creador…"
        gridTarjetas="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        tarjetaSinMarco
        vacio={
          <>
            <ClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="font-body text-sm text-gray-400">
              {tab === 'entregar' ? 'No hay órdenes pendientes por entregar.'
                : tab === 'proceso' ? 'No hay órdenes por procesar.'
                : filtroEstado !== 'todos' ? 'No hay órdenes con ese estado.'
                : 'Aún no hay órdenes de insumo.'}
            </p>
          </>
        }
        renderTarjeta={o => {
          const meta = metaEstado(o.estado)
          const urg = calcularUrgencia(o)
          const pct = o.total_items > 0 ? Math.round((o.alistados / o.total_items) * 100) : 0
          // Borde de acento para lo más urgente.
          const acento = urg.nivel === 'VENCIDA' ? 'border-red-300' : urg.nivel === 'HOY' ? 'border-orange-300' : urg.nivel === 'URGENTE' ? 'border-amber-300' : 'border-gray-100'
          return (
            <Link href={`/ordenes-insumo/${o.id}`}
              className={`bg-white border rounded-2xl p-4 shadow-sm hover:border-brand-green/40 hover:shadow transition-all group block ${acento}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-heading font-bold text-sm text-gray-900">{o.numero}</p>
                  <p className="font-body text-xs text-gray-500 flex items-center gap-1 mt-0.5 min-w-0">
                    <MapPin className="w-3 h-3 text-brand-green shrink-0" />
                    <span className="truncate" title={o.sede}>{o.sede}</span>
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

              {tieneComentarios(o) && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-gray-50 px-2 py-1.5 font-body text-xs text-gray-600">
                  {o.observacion
                    ? <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    : <MessageSquare className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />}
                  <span className="line-clamp-2">{o.ultimo_comentario ?? o.observacion}</span>
                </p>
              )}

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
        }}
      />
    </div>
  )
}
