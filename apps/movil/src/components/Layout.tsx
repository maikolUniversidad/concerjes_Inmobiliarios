import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { RefreshCw, Wifi, WifiOff, LogOut, CloudUpload, Package, BarChart3, ArrowLeftRight, Warehouse, ClipboardCheck, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { store } from '../lib/db'
import { estaEnLinea, sincronizarTodo } from '../lib/sync'
import { usePermisos } from './Permisos'
import { TAB_PERMISO } from '../lib/permisos'
import { PinSetup } from './PinSetup'
import { EVENTO_SYNC } from '../lib/eventos'
export { EVENTO_SYNC }

export type Tab = 'productos' | 'stock' | 'movimientos' | 'bodegas' | 'arqueo'
const TABS: { id: Tab; label: string; icon: typeof Package }[] = [
  { id: 'productos', label: 'Productos', icon: Package },
  { id: 'stock', label: 'Stock', icon: BarChart3 },
  { id: 'movimientos', label: 'Movim.', icon: ArrowLeftRight },
  { id: 'bodegas', label: 'Bodegas', icon: Warehouse },
  { id: 'arqueo', label: 'Arqueo', icon: ClipboardCheck },
]

export function Layout({ session, tab, onTab, children }: { session: Session; tab: Tab; onTab: (t: Tab) => void; children: React.ReactNode }) {
  const { tiene } = usePermisos()
  const [online, setOnline] = useState(estaEnLinea())
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [outbox, setOutbox] = useState(0)
  const [pinOpen, setPinOpen] = useState(false)
  const tabsVisibles = TABS.filter(t => tiene(TAB_PERMISO[t.id]))

  const refrescarOutbox = useCallback(async () => { setOutbox((await store.getOutbox()).length) }, [])

  const sync = useCallback(async () => {
    if (syncing || !estaEnLinea()) return
    setSyncing(true); setMsg('')
    try {
      const res = await sincronizarTodo((t) => setMsg(t))
      const total = Object.values(res.pulled).reduce((a, b) => a + b, 0)
      setMsg(res.errores.length ? `Sincronizado con ${res.errores.length} error(es)` : `✓ ${total} registros actualizados`)
      window.dispatchEvent(new Event(EVENTO_SYNC))
    } catch (e) {
      setMsg('Error: ' + (e instanceof Error ? e.message : 'sync'))
    } finally {
      setSyncing(false); refrescarOutbox()
      setTimeout(() => setMsg(''), 4000)
    }
  }, [syncing, refrescarOutbox])

  // Estado de conexión + primera sincronización + auto-sync al reconectar
  useEffect(() => {
    refrescarOutbox()
    const on = () => { setOnline(true); sync() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    if (estaEnLinea()) sync()
    const iv = window.setInterval(refrescarOutbox, 5000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Si la pestaña activa no es visible para el rol, cambia a la primera visible.
  useEffect(() => {
    if (tabsVisibles.length && !tabsVisibles.some(t => t.id === tab)) onTab(tabsVisibles[0].id)
  }, [tabsVisibles, tab, onTab])

  const inicial = (session.user.email ?? 'U').slice(0, 1).toUpperCase()

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 shrink-0">
        <span className="text-xl">📦</span>
        <div className="min-w-0">
          <p className="font-bold text-sm text-gray-900 leading-tight truncate">Conserjes Inventario</p>
          <span className={`inline-flex items-center gap-1 text-[11px] ${online ? 'text-green-600' : 'text-amber-600'}`}>
            {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {online ? 'En línea' : 'Sin conexión'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {outbox > 0 && (
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-1 rounded-full" title="Cambios pendientes de subir">
              <CloudUpload className="w-3.5 h-3.5" /> {outbox}
            </span>
          )}
          <button onClick={sync} disabled={syncing || !online}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40" title="Sincronizar">
            <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin text-brand-green' : ''}`} />
          </button>
          <button onClick={() => setPinOpen(true)} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100" title="Seguridad / PIN">
            <ShieldCheck className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-brand-green text-white text-xs font-bold flex items-center justify-center">{inicial}</div>
          <button onClick={() => supabase.auth.signOut()} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Salir">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {msg && <div className="bg-brand-green/10 text-brand-green text-xs px-4 py-1.5 text-center shrink-0">{syncing ? `Sincronizando: ${msg}` : msg}</div>}

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      {/* Navegación inferior (solo pestañas permitidas) */}
      <nav className="shrink-0 bg-white border-t border-gray-200 flex pb-[env(safe-area-inset-bottom)]">
        {tabsVisibles.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => onTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${active ? 'text-brand-green' : 'text-gray-400'}`}>
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          )
        })}
      </nav>

      {pinOpen && <PinSetup onClose={() => setPinOpen(false)} />}
    </div>
  )
}
