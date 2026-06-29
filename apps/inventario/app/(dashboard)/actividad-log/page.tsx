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

// ─── Row Component ─────────────────────────────────────────────────────────────

function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = log.detalle && Object.keys(log.detalle).length > 0

  return (
    <>
      <tr className="hover:bg-gray-50/60 transition-colors">
        <td className="px-4 py-2.5 whitespace-nowrap">
          <span className="font-body text-xs text-gray-500">{formatDateTime(log.created_at)}</span>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <SmallAvatar
              url={log.usuarios?.avatar_url ?? null}
              nombre={log.usuarios?.nombre ?? log.usuario_nombre}
            />
            <span className="font-body text-xs text-gray-700 leading-tight">
              {log.usuarios?.nombre ?? log.usuario_nombre ?? log.usuario_email ?? '—'}
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className={`font-body text-xs font-medium px-2 py-0.5 rounded-full ${moduloColor(log.modulo)}`}>
            {log.modulo}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className="font-body text-xs font-semibold text-gray-700 uppercase tracking-wide">
            {log.accion}
          </span>
        </td>
        <td className="px-4 py-2.5 max-w-xs">
          <span className="font-body text-xs text-gray-600 line-clamp-2">{log.descripcion}</span>
        </td>
        <td className="px-4 py-2.5 hidden lg:table-cell">
          <span className="font-body text-xs text-gray-400">{log.entidad ?? '—'}</span>
        </td>
        <td className="px-4 py-2.5 w-8">
          {hasDetail ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : null}
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <pre className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs font-mono text-gray-600 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(log.detalle, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ActividadLogPage() {
  const supabase = createClient()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filters
  const [moduloFilter, setModuloFilter] = useState('')
  const [usuarioFilter, setUsuarioFilter] = useState('')
  const [accionFilter, setAccionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      try {
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
    [supabase]
  )

  useEffect(() => {
    fetchLogs()
    intervalRef.current = setInterval(() => fetchLogs(true), 30_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchLogs])

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
    if (search) {
      const q = search.toLowerCase()
      if (
        !l.descripcion.toLowerCase().includes(q) &&
        !(l.accion ?? '').toLowerCase().includes(q) &&
        !(l.entidad ?? '').toLowerCase().includes(q)
      )
        return false
    }
    return true
  })

  const selectCls =
    'border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs outline-none focus:border-[#2E7D32] bg-white text-gray-700'

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
            onClick={() => downloadCsv(buildCsv(filtered))}
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

        <input
          type="text"
          placeholder="Buscar en descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${selectCls} flex-1 min-w-[160px]`}
        />

        {(moduloFilter || accionFilter || usuarioFilter || dateFrom || dateTo || search) && (
          <button
            type="button"
            onClick={() => {
              setModuloFilter('')
              setAccionFilter('')
              setUsuarioFilter('')
              setDateFrom('')
              setDateTo('')
              setSearch('')
            }}
            className="font-body text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-[#2E7D32]" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                    Fecha / Hora
                  </th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                    Usuario
                  </th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                    Módulo
                  </th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                    Acción
                  </th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                    Descripción
                  </th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 hidden lg:table-cell">
                    Entidad
                  </th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-20 text-center">
                      <Activity className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="font-body text-sm text-gray-400">No hay registros de actividad</p>
                    </td>
                  </tr>
                )}
                {filtered.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="border-t border-gray-50 px-4 py-2.5 flex items-center justify-between">
            <span className="font-body text-xs text-gray-400">
              {filtered.length} registro{filtered.length !== 1 ? 's' : ''}{' '}
              {filtered.length !== logs.length ? `(filtrado de ${logs.length})` : ''}
            </span>
            {refreshing && (
              <span className="flex items-center gap-1.5 font-body text-xs text-gray-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                Actualizando…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
