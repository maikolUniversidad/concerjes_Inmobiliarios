'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRequierePermiso } from '@/components/permisos/PermisosProvider'
import { TablaEstandar, registrarCopia, type ColumnaTabla } from '@/components/ui/tabla'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogUsuario {
  nombre: string | null
  avatar_url: string | null
}

interface LogEntry {
  id: string
  created_at: string
  accion: string
  modulo: string
  descripcion: string
  entidad: string | null
  entidad_id: string | null
  detalle: Record<string, unknown> | null
  usuario_id: string | null
  usuario_email: string | null
  usuario_nombre: string | null
  usuarios: LogUsuario | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULO_COLORS: Record<string, string> = {
  Inventario: 'bg-blue-100 text-blue-700',
  Usuarios: 'bg-purple-100 text-purple-700',
  Galería: 'bg-green-100 text-green-700',
  SST: 'bg-orange-100 text-orange-700',
  Compras: 'bg-yellow-100 text-yellow-700',
  Sistema: 'bg-gray-100 text-gray-700',
  Activos: 'bg-teal-100 text-teal-700',
}

function moduloColor(modulo: string) {
  return MODULO_COLORS[modulo] ?? 'bg-gray-100 text-gray-600'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initials(name: string | null) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function SmallAvatar({ url, nombre }: { url: string | null; nombre: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt={nombre ?? ''}
        className="w-6 h-6 rounded-full object-cover shrink-0"
      />
    )
  }
  return (
    <div className="w-6 h-6 rounded-full bg-[#2E7D32] flex items-center justify-center text-white font-heading font-bold text-[10px] shrink-0">
      {initials(nombre)}
    </div>
  )
}

function buildCsv(logs: LogEntry[]): string {
  const headers = ['Fecha', 'Usuario', 'Email', 'Módulo', 'Acción', 'Descripción', 'Entidad', 'Entidad ID']
  const rows = logs.map((l) => [
    formatDateTime(l.created_at),
    l.usuarios?.nombre ?? l.usuario_nombre ?? '',
    l.usuario_email ?? '',
    l.modulo,
    l.accion,
    l.descripcion,
    l.entidad ?? '',
    l.entidad_id ?? '',
  ])
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `actividad_log_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Detalle expandible ────────────────────────────────────────────────────────

function DetalleCelda({ detalle }: { detalle: Record<string, unknown> | null }) {
  if (!detalle || Object.keys(detalle).length === 0) {
    return <span className="font-body text-xs text-gray-300">—</span>
  }
  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-body text-xs text-gray-400 hover:text-gray-600">
        <ChevronRight className="inline w-3.5 h-3.5 group-open:hidden" />
        <ChevronDown className="hidden w-3.5 h-3.5 group-open:inline" />
        Ver
      </summary>
      <pre className="mt-1 max-w-[320px] overflow-x-auto whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-2 font-mono text-[11px] text-gray-600">
        {JSON.stringify(detalle, null, 2)}
      </pre>
    </details>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ActividadLogPage() {
  const permitido = useRequierePermiso('ver_actividad_log')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filters
  const [moduloFilter, setModuloFilter] = useState('')
  const [usuarioFilter, setUsuarioFilter] = useState('')
  const [accionFilter, setAccionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('actividad_log')
          .select('*, usuarios(nombre, avatar_url)')
          .order('created_at', { ascending: false })
          .limit(200)
        setLogs((data as unknown as LogEntry[]) ?? [])
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    fetchLogs()
    intervalRef.current = setInterval(() => fetchLogs(true), 30_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchLogs])

  if (!permitido) return null

  // Derived filter lists
  const allModulos = Array.from(new Set(logs.map((l) => l.modulo))).sort()
  const allUsuarios = Array.from(
    new Set(logs.map((l) => l.usuarios?.nombre ?? l.usuario_nombre ?? l.usuario_email ?? '').filter(Boolean))
  ).sort()
  const allAcciones = Array.from(new Set(logs.map((l) => l.accion))).sort()

  const filtered = logs.filter((l) => {
    if (moduloFilter && l.modulo !== moduloFilter) return false
    if (accionFilter && l.accion !== accionFilter) return false
    if (usuarioFilter) {
      const name = l.usuarios?.nombre ?? l.usuario_nombre ?? l.usuario_email ?? ''
      if (!name.toLowerCase().includes(usuarioFilter.toLowerCase())) return false
    }
    if (dateFrom && l.created_at < dateFrom) return false
    if (dateTo && l.created_at > dateTo + 'T23:59:59') return false
    return true
  })

  const selectCls =
    'border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs outline-none focus:border-[#2E7D32] bg-white text-gray-700'

  const columnas: ColumnaTabla<LogEntry>[] = [
    {
      id: 'fecha', header: 'Fecha / Hora', valor: (l) => formatDateTime(l.created_at),
      className: 'whitespace-nowrap text-xs text-gray-500', tarjeta: 'meta',
    },
    {
      id: 'usuario', header: 'Usuario', tarjeta: 'titulo',
      valor: (l) => l.usuarios?.nombre ?? l.usuario_nombre ?? l.usuario_email ?? '',
      celda: (l) => (
        <div className="flex items-center gap-2">
          <SmallAvatar url={l.usuarios?.avatar_url ?? null} nombre={l.usuarios?.nombre ?? l.usuario_nombre} />
          <span className="font-body text-xs text-gray-700 leading-tight">
            {l.usuarios?.nombre ?? l.usuario_nombre ?? l.usuario_email ?? '—'}
          </span>
        </div>
      ),
    },
    { id: 'email', header: 'Correo', valor: (l) => l.usuario_email ?? '', prioridad: 3, className: 'text-xs text-gray-400', tarjeta: 'oculto' },
    {
      id: 'modulo', header: 'Módulo', valor: (l) => l.modulo, tarjeta: 'badge',
      celda: (l) => (
        <span className={`font-body text-xs font-medium px-2 py-0.5 rounded-full ${moduloColor(l.modulo)}`}>{l.modulo}</span>
      ),
    },
    {
      id: 'accion', header: 'Acción', valor: (l) => l.accion, prioridad: 2, tarjeta: 'meta',
      className: 'font-semibold uppercase tracking-wide text-xs text-gray-700',
    },
    {
      id: 'descripcion', header: 'Descripción', valor: (l) => l.descripcion, ancho: 'max-w-xs',
      className: 'text-xs text-gray-600', tarjeta: 'cuerpo',
    },
    { id: 'entidad', header: 'Entidad', valor: (l) => l.entidad ?? '', prioridad: 3, className: 'text-xs text-gray-400', tarjeta: 'oculto' },
    {
      id: 'detalle', header: 'Detalle', copiable: false, filtrable: false, prioridad: 3, tarjeta: 'oculto',
      valor: () => '', celda: (l) => <DetalleCelda detalle={l.detalle} />,
    },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Log de Actividad</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Últimas 200 acciones · Actualización automática cada 30 s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchLogs(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => {
              downloadCsv(buildCsv(filtered))
              void registrarCopia({
                modulo: 'Sistema', entidad: 'actividad_log', titulo: 'Log de actividad',
                filas: filtered.length, columnas: ['Fecha', 'Usuario', 'Email', 'Módulo', 'Acción', 'Descripción', 'Entidad', 'Entidad ID'],
                origen: 'descarga',
              })
            }}
            className="flex items-center gap-1.5 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-xs px-3 py-2 rounded-xl transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white p-3 flex flex-wrap items-center gap-2">
        <select
          value={moduloFilter}
          onChange={(e) => setModuloFilter(e.target.value)}
          className={selectCls}
        >
          <option value="">Todos los módulos</option>
          {allModulos.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={accionFilter}
          onChange={(e) => setAccionFilter(e.target.value)}
          className={selectCls}
        >
          <option value="">Todas las acciones</option>
          {allAcciones.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filtrar por usuario..."
          value={usuarioFilter}
          onChange={(e) => setUsuarioFilter(e.target.value)}
          className={`${selectCls} w-40`}
        />

        <div className="flex items-center gap-1">
          <label className="font-body text-xs text-gray-400">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={selectCls}
          />
        </div>

        <div className="flex items-center gap-1">
          <label className="font-body text-xs text-gray-400">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={selectCls}
          />
        </div>

        {(moduloFilter || accionFilter || usuarioFilter || dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setModuloFilter('')
              setAccionFilter('')
              setUsuarioFilter('')
              setDateFrom('')
              setDateTo('')
            }}
            className="font-body text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-[#2E7D32]" />
        </div>
      ) : (
        <TablaEstandar
          id="actividad-log"
          titulo="Log de actividad"
          modulo="Sistema"
          entidad="actividad_log"
          datos={filtered}
          columnas={columnas}
          filaId={(l) => l.id}
          busqueda="Buscar en descripción, acción o entidad…"
          descargable={false}
          vacio={
            <>
              <Activity className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="font-body text-sm text-gray-400">No hay registros de actividad</p>
            </>
          }
          herramientas={refreshing ? (
            <span className="flex items-center gap-1.5 font-body text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Actualizando…
            </span>
          ) : null}
        />
      )}
    </div>
  )
}
