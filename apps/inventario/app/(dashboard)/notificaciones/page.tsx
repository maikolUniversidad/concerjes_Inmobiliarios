'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Bell, BellOff, Check, CheckCheck, Trash2, Archive, Settings, Loader2,
  PackageMinus, PackageX, PackageCheck, FileText, CalendarClock,
  ArrowLeftRight, Mail, UserPlus, Megaphone, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  SEVERIDAD_LABELS, TIPO_NOTIFICACION_LABELS,
  type Notificacion, type TipoNotificacion, type EstadoNotificacion,
} from '@/lib/types/database'

const ICONS: Record<TipoNotificacion, LucideIcon> = {
  STOCK_BAJO: PackageMinus,
  STOCK_AGOTADO: PackageX,
  OC_CREADA: FileText,
  OC_RECIBIDA: PackageCheck,
  OC_POR_VENCER: CalendarClock,
  MOVIMIENTO: ArrowLeftRight,
  CONTACTO_WEB: Mail,
  USUARIO_NUEVO: UserPlus,
  SISTEMA: Megaphone,
}

type Tab = 'NO_LEIDA' | 'TODAS' | 'ARCHIVADA'

function tiempoRelativo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function NotificacionesPage() {
  const [items, setItems] = useState<Notificacion[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('NO_LEIDA')
  const [tipoFilter, setTipoFilter] = useState<'' | TipoNotificacion>('')
  const [busy, setBusy] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchItems = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data } = await supabase
      .from('notificaciones')
      .select('*')
      .eq('usuario_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)
    setItems((data as Notificacion[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchItems()
    intervalRef.current = setInterval(fetchItems, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchItems])

  async function cambiarEstado(id: string, estado: EstadoNotificacion) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient() as any
    const patch: Partial<Notificacion> = { estado }
    if (estado === 'LEIDA') patch.leido_at = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } as Notificacion : n)))
    await supabase.from('notificaciones').update(patch).eq('id', id)
  }

  async function eliminar(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient() as any
    setItems((prev) => prev.filter((n) => n.id !== id))
    await supabase.from('notificaciones').delete().eq('id', id)
  }

  async function marcarTodasLeidas() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setBusy(true)
    setItems((prev) => prev.map((n) => (n.estado === 'NO_LEIDA' ? { ...n, estado: 'LEIDA', leido_at: new Date().toISOString() } : n)))
    await supabase
      .from('notificaciones')
      .update({ estado: 'LEIDA', leido_at: new Date().toISOString() })
      .eq('usuario_id', user.id)
      .eq('estado', 'NO_LEIDA')
    setBusy(false)
  }

  const noLeidas = items.filter((n) => n.estado === 'NO_LEIDA').length

  const visibles = items
    .filter((n) => (tab === 'TODAS' ? n.estado !== 'ARCHIVADA' : n.estado === tab))
    .filter((n) => !tipoFilter || n.tipo === tipoFilter)

  const tiposPresentes = Array.from(new Set(items.map((n) => n.tipo)))

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'NO_LEIDA', label: 'Sin leer', count: noLeidas },
    { key: 'TODAS', label: 'Todas' },
    { key: 'ARCHIVADA', label: 'Archivadas' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Notificaciones</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {noLeidas > 0 ? `${noLeidas} sin leer` : 'Estás al día'} · {items.length} en total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={marcarTodasLeidas}
            disabled={busy || noLeidas === 0}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Marcar todas leídas
          </button>
          <Link
            href="/configuracion/alertas"
            className="flex items-center gap-1.5 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-xs px-3 py-2 rounded-xl transition-colors"
          >
            <Settings className="w-3.5 h-3.5" /> Configurar alertas
          </Link>
        </div>
      </div>

      {/* Tabs + filtro por tipo */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-colors',
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t.label}
              {t.count ? (
                <span className="bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[10px] leading-none">{t.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value as '' | TipoNotificacion)}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs outline-none focus:border-[#2E7D32] bg-white text-gray-700"
        >
          <option value="">Todos los tipos</option>
          {tiposPresentes.map((t) => (
            <option key={t} value={t}>{TIPO_NOTIFICACION_LABELS[t].label}</option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-[#2E7D32]" />
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-white py-20 text-center">
          {tab === 'NO_LEIDA' ? (
            <BellOff className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          ) : (
            <Bell className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          )}
          <p className="font-body text-sm text-gray-400">
            {tab === 'NO_LEIDA' ? 'No tienes notificaciones sin leer' : 'No hay notificaciones aquí'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibles.map((n) => {
            const Icon = ICONS[n.tipo] ?? Bell
            const sev = SEVERIDAD_LABELS[n.severidad]
            const noLeida = n.estado === 'NO_LEIDA'
            return (
              <div
                key={n.id}
                className={[
                  'group flex items-start gap-3 rounded-2xl border p-4 transition-colors',
                  noLeida ? sev.bg : 'bg-white border-gray-100',
                ].join(' ')}
              >
                <div className={`mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${sev.bg}`}>
                  <Icon className={`w-4.5 h-4.5 ${sev.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {noLeida && <span className={`w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />}
                    <span className="font-heading font-semibold text-sm text-gray-900">{n.titulo}</span>
                    <span className={`font-body text-[10px] px-1.5 py-0.5 rounded-full ${sev.color} ${sev.bg}`}>
                      {sev.label}
                    </span>
                  </div>
                  {n.descripcion && (
                    <p className="font-body text-xs text-gray-600 mt-1 leading-relaxed">{n.descripcion}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="font-body text-[11px] text-gray-400">{tiempoRelativo(n.created_at)}</span>
                    <span className="font-body text-[11px] text-gray-300">·</span>
                    <span className="font-body text-[11px] text-gray-400">{TIPO_NOTIFICACION_LABELS[n.tipo].label}</span>
                    {n.enlace && (
                      <Link href={n.enlace} className="font-body text-[11px] text-[#2E7D32] hover:underline font-semibold">
                        Ver detalle →
                      </Link>
                    )}
                  </div>
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {noLeida && (
                    <button
                      type="button"
                      onClick={() => cambiarEstado(n.id, 'LEIDA')}
                      title="Marcar como leída"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  {n.estado !== 'ARCHIVADA' && (
                    <button
                      type="button"
                      onClick={() => cambiarEstado(n.id, 'ARCHIVADA')}
                      title="Archivar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => eliminar(n.id)}
                    title="Eliminar"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
