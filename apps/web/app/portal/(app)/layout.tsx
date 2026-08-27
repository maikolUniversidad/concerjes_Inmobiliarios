'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { Session } from '@supabase/supabase-js'
import {
  Loader2, LayoutDashboard, CalendarPlus, ClipboardList, CalendarDays, UserRound,
  LogOut, Menu, X, Wallet, Bell,
} from 'lucide-react'
import { getPortalSupabase, asegurarCliente, cerrarSesionPortal } from '@/lib/supabase/portal'
import { PortalProvider } from './_portal/PortalProvider'

interface Contadores { cobros: number; avisos: number }

interface ItemNav {
  href: string
  label: string
  icon: React.ElementType
  /** Badge del ítem: de qué contador se alimenta. */
  contador?: keyof Contadores
}

const NAV: ItemNav[] = [
  { href: '/portal',                label: 'Inicio',         icon: LayoutDashboard },
  { href: '/portal/solicitar',      label: 'Agendar',        icon: CalendarPlus },
  { href: '/portal/servicios',      label: 'Mis servicios',  icon: ClipboardList },
  { href: '/portal/pagos',          label: 'Mis pagos',      icon: Wallet,       contador: 'cobros' },
  { href: '/portal/agenda',         label: 'Disponibilidad', icon: CalendarDays },
  { href: '/portal/notificaciones', label: 'Avisos',         icon: Bell,         contador: 'avisos' },
  { href: '/portal/perfil',         label: 'Mi perfil',      icon: UserRound },
]

export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<Session | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'no-auth'>('cargando')
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [contadores, setContadores] = useState<Contadores>({ cobros: 0, avisos: 0 })

  useEffect(() => {
    const sb = getPortalSupabase()
    let activo = true

    sb.auth.getSession().then(async ({ data }) => {
      if (!activo) return
      if (data.session) {
        setSession(data.session)
        setEstado('ok')
        asegurarCliente()
      } else {
        setEstado('no-auth')
        const destino = typeof window !== 'undefined' ? pathname + window.location.search : pathname
        router.replace(`/portal/ingresar?next=${encodeURIComponent(destino)}`)
      }
    })

    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      if (!activo) return
      if (s) { setSession(s); setEstado('ok') }
      else { setEstado('no-auth'); router.replace('/portal/ingresar') }
    })
    return () => { activo = false; sub.subscription.unsubscribe() }
  }, [router, pathname])

  // Badges: cobros por pagar y avisos sin leer. Se recalculan al navegar.
  useEffect(() => {
    const uid = session?.user.id
    if (!uid) return
    let activo = true
    const sb = getPortalSupabase()
    Promise.all([
      sb.from('cobros_servicio_hogar').select('id', { count: 'exact', head: true })
        .eq('cliente_id', uid).in('estado', ['EMITIDO', 'PARCIAL']),
      sb.from('notificaciones_cliente').select('id', { count: 'exact', head: true })
        .eq('cliente_id', uid).eq('leida', false),
    ]).then(([cobros, avisos]) => {
      if (!activo) return
      setContadores({ cobros: cobros.count ?? 0, avisos: avisos.count ?? 0 })
    })
    return () => { activo = false }
  }, [session?.user.id, pathname])

  async function salir() {
    await cerrarSesionPortal()
    router.replace('/portal/ingresar')
  }

  if (estado !== 'ok' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-green" />
      </div>
    )
  }

  return (
    <PortalProvider session={session}>
      <div className="flex min-h-screen">
        {/* Sidebar desktop */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
          <Link href="/portal" className="block px-5 py-5">
            <Image src="/logo-horizontal.png" alt="Conserjes Inmobiliarios" width={200} height={50} priority className="h-8 w-auto" />
            <span className="mt-1.5 block text-xs font-semibold text-brand-green/70">Portal de clientes</span>
          </Link>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {NAV.map((n) => (
              <NavLink key={n.href} href={n.href} label={n.label} icon={n.icon}
                activo={esActivo(pathname, n.href)}
                badge={n.contador ? contadores[n.contador] : 0} />
            ))}
          </nav>
          <button onClick={salir} className="m-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-red-600">
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </aside>

        {/* Contenido */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar móvil */}
          <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
            <Link href="/portal" className="flex items-center gap-2">
              <Image src="/logo-horizontal.png" alt="Conserjes Inmobiliarios" width={180} height={45} className="h-7 w-auto" />
              <span className="text-xs font-semibold text-brand-green/70">· Portal</span>
            </Link>
            <button onClick={() => setMenuAbierto((v) => !v)} className="p-1.5 text-gray-600">
              {menuAbierto ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </header>

          {menuAbierto && (
            <nav className="space-y-1 border-b border-gray-200 bg-white px-3 py-3 lg:hidden">
              {NAV.map((n) => (
                <div key={n.href} onClick={() => setMenuAbierto(false)}>
                  <NavLink href={n.href} label={n.label} icon={n.icon}
                    activo={esActivo(pathname, n.href)}
                    badge={n.contador ? contadores[n.contador] : 0} />
                </div>
              ))}
              <button onClick={salir} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-red-600">
                <LogOut className="h-4 w-4" /> Cerrar sesión
              </button>
            </nav>
          )}

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </PortalProvider>
  )
}

function NavLink({ href, label, icon: Icon, activo, badge = 0 }: {
  href: string; label: string; icon: React.ElementType; activo: boolean; badge?: number
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
        activo ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-brand-green/5 hover:text-brand-green'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${
          activo ? 'bg-white text-brand-green' : 'bg-brand-green text-white'
        }`}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  )
}

function esActivo(pathname: string, href: string) {
  if (href === '/portal') return pathname === '/portal'
  return pathname.startsWith(href)
}
