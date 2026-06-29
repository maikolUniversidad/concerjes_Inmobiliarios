'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, BellOff, CheckCheck, Loader2, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SEVERIDAD_LABELS, TIPO_NOTIFICACION_LABELS, type Notificacion } from '@/lib/types/database'

function tiempoRelativo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Notificacion[]>([])
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const fetchCount = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { count: c } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', user.id)
      .eq('estado', 'NO_LEIDA')
    setCount(c ?? 0)
  }, [])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('notificaciones')
        .select('*')
        .eq('usuario_id', user.id)
        .neq('estado', 'ARCHIVADA')
        .order('created_at', { ascending: false })
        .limit(8)
      setItems((data as Notificacion[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCount()
    intervalRef.current = setInterval(fetchCount, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchCount])

  // Cerrar al hacer clic fuera o con Escape
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) fetchItems()
  }

  async function abrir(n: Notificacion) {
    setOpen(false)
    if (n.estado === 'NO_LEIDA') {
      const supabase = createClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('notificaciones')
        .update({ estado: 'LEIDA', leido_at: new Date().toISOString() })
        .eq('id', n.id)
      setCount(c => Math.max(0, c - 1))
    }
    router.push(n.enlace || '/notificaciones')
  }

  async function marcarTodas() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setItems(prev => prev.map(n => (n.estado === 'NO_LEIDA' ? { ...n, estado: 'LEIDA' } : n)))
    setCount(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('notificaciones')
      .update({ estado: 'LEIDA', leido_at: new Date().toISOString() })
      .eq('usuario_id', user.id)
      .eq('estado', 'NO_LEIDA')
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label={`Notificaciones${count > 0 ? ` (${count} sin leer)` : ''}`}
        aria-expanded={open}
      >
        <Bell className="w-5 h-5 text-gray-600" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white rounded-full flex items-center justify-center font-body font-bold text-[10px] leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-w-[calc(100vw-1.5rem)] bg-white border border-gray-100 rounded-2xl shadow-xl z-50 overflow-hidden">
          {/* Cabecera */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
            <div>
              <p className="font-heading font-bold text-sm text-gray-900">Notificaciones</p>
              <p className="font-body text-xs text-gray-400">{count > 0 ? `${count} sin leer` : 'Estás al día'}</p>
            </div>
            {count > 0 && (
              <button onClick={marcarTodas}
                className="flex items-center gap-1 font-body text-xs text-gray-500 hover:text-brand-green transition-colors">
                <CheckCheck className="w-3.5 h-3.5" /> Marcar leídas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-brand-green" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
                <BellOff className="w-8 h-8 text-gray-200" />
                <p className="font-body text-sm text-gray-400">No tienes notificaciones</p>
              </div>
            ) : (
              items.map(n => {
                const sev = SEVERIDAD_LABELS[n.severidad]
                const noLeida = n.estado === 'NO_LEIDA'
                return (
                  <button key={n.id} onClick={() => abrir(n)}
                    className={`w-full text-left flex items-start gap-2.5 px-4 py-3 border-b border-gray-50 hover:bg-gray-50/70 transition-colors ${noLeida ? 'bg-green-50/40' : ''}`}>
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${noLeida ? sev.dot : 'bg-gray-200'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`font-body text-sm truncate ${noLeida ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{n.titulo}</p>
                      {n.descripcion && <p className="font-body text-xs text-gray-500 line-clamp-2 mt-0.5">{n.descripcion}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-body text-[11px] text-gray-400">{TIPO_NOTIFICACION_LABELS[n.tipo]?.label ?? n.tipo}</span>
                        <span className="font-body text-[11px] text-gray-300">·</span>
                        <span className="font-body text-[11px] text-gray-400">{tiempoRelativo(n.created_at)}</span>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Pie: historial */}
          <Link href="/notificaciones" onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 px-4 py-3 border-t border-gray-100 font-body text-sm font-semibold text-brand-green hover:bg-green-50 transition-colors">
            Ver historial de notificaciones <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  )
}
