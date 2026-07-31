'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'
import {
  Loader2, LayoutDashboard, CalendarPlus, ClipboardList, CalendarDays, UserRound,
  LogOut, Menu, X,
} from 'lucide-react'
import { getPortalSupabase, asegurarCliente, cerrarSesionPortal } from '@/lib/supabase/portal'
import { PortalProvider } from './_portal/PortalProvider'

const NAV = [
  { href: '/portal',            label: 'Inicio',        icon: LayoutDashboard },
  { href: '/portal/solicitar',  label: 'Agendar',       icon: CalendarPlus },
  { href: '/portal/servicios',  label: 'Mis servicios', icon: ClipboardList },
  { href: '/portal/agenda',     label: 'Disponibilidad', icon: CalendarDays },
  { href: '/portal/perfil',     label: 'Mi perfil',     icon: UserRound },
]

export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<Session | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'no-auth'>('cargando')
  const [menuAbierto, setMenuAbierto] = useState(false)

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
          <Link href="/portal" className="flex items-center gap-2 px-6 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green">
              <span className="font-heading text-base font-bold text-white">CI</span>
            </div>
            <span className="font-heading text-sm font-bold text-brand-green leading-tight">Portal<br />Clientes</span>
          </Link>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {NAV.map((n) => (
              <NavLink key={n.href} {...n} activo={esActivo(pathname, n.href)} />
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green">
                <span className="font-heading text-sm font-bold text-white">CI</span>
              </div>
              <span className="font-heading text-sm font-bold text-brand-green">Portal Clientes</span>
            </Link>
            <button onClick={() => setMenuAbierto((v) => !v)} className="p-1.5 text-gray-600">
              {menuAbierto ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </header>

          {menuAbierto && (
            <nav className="space-y-1 border-b border-gray-200 bg-white px-3 py-3 lg:hidden">
              {NAV.map((n) => (
                <div key={n.href} onClick={() => setMenuAbierto(false)}>
                  <NavLink {...n} activo={esActivo(pathname, n.href)} />
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

function NavLink({ href, label, icon: Icon, activo }: { href: string; label: string; icon: React.ElementType; activo: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
        activo ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-brand-green/5 hover:text-brand-green'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  )
}

function esActivo(pathname: string, href: string) {
  if (href === '/portal') return pathname === '/portal'
  return pathname.startsWith(href)
}
