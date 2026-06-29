'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { PanelLeft, Search } from 'lucide-react'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  // Páginas tipo "app" de altura completa (chat): gestionan su propio scroll
  // y no deben llevar el padding inferior de las páginas normales.
  const isFullHeight = pathname?.startsWith('/ia/asistente') ?? false

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── SIDEBAR (solo desktop) ──
          En móvil la navegación vive en la barra inferior (MobileNav).
      */}
      <div
        className={[
          'hidden lg:flex flex-shrink-0 transition-[width] duration-300 ease-in-out',
          collapsed ? 'lg:w-16' : 'lg:w-64',
        ].join(' ')}
      >
        <Sidebar collapsed={collapsed} />
      </div>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* TOPBAR */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center gap-3 px-3 sm:px-5 shrink-0">
          {/* Marca compacta en móvil — solo el ícono */}
          <Link href="/dashboard" className="flex items-center lg:hidden" aria-label="Inicio">
            <Image src="/icon.png" alt="Conserjes Inmobiliarios" width={36} height={36} className="rounded-lg shrink-0" priority />
          </Link>

          {/* Colapsar sidebar — solo desktop */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:inline-flex p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Colapsar menú"
          >
            <PanelLeft className="w-5 h-5 text-gray-600" />
          </button>

          {/* Search — oculto en pantallas pequeñas */}
          <div className="flex-1 max-w-xs hidden sm:flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              placeholder="Buscar..."
              className="bg-transparent font-body text-sm text-gray-700 placeholder:text-gray-400 flex-1 outline-none w-0"
            />
          </div>

          {/* Spacer */}
          <div className="flex-1 sm:flex-none" />

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {/* Search icon on mobile */}
            <button className="sm:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Buscar">
              <Search className="w-5 h-5 text-gray-500" />
            </button>

            {/* Notifications */}
            <NotificationBell />

            {/* Avatar → Mi Perfil */}
            <Link
              href="/perfil"
              className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center ml-1 hover:ring-2 hover:ring-brand-green/30 transition-all"
              aria-label="Mi perfil"
              title="Mi perfil"
            >
              <span className="text-white font-heading font-bold text-xs">A</span>
            </Link>
          </div>
        </header>

        {/* CONTENT
            - Páginas normales: scroll propio + espacio inferior en móvil para no
              quedar bajo la barra (la barra mide ~4rem + safe-area).
            - Páginas de altura completa (chat): sin scroll ni padding; ellas
              gestionan su propio alto y dejan el hueco para la barra. */}
        <main
          className={
            isFullHeight
              ? 'flex-1 min-h-0 overflow-hidden'
              : 'flex-1 min-h-0 overflow-y-auto pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0'
          }
        >
          {children}
        </main>
      </div>

      {/* ── NAV INFERIOR (solo móvil) ── */}
      <MobileNav />
    </div>
  )
}
