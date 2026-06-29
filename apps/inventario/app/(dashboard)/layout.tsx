'use client'

import { useState, useCallback } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Menu, Bell, Search, X } from 'lucide-react'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── MOBILE BACKDROP ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* ── SIDEBAR ──
          Mobile: fixed overlay (z-50), slides in/out
          Desktop: static, collapsible
      */}
      <div
        className={[
          // base
          'fixed inset-y-0 left-0 z-50 flex-shrink-0 transition-transform duration-300 ease-in-out',
          // mobile: show/hide via translate
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // desktop: always visible, no translate
          'lg:relative lg:translate-x-0 lg:z-auto',
          // width
          collapsed ? 'lg:w-16' : 'lg:w-64',
          'w-72',
        ].join(' ')}
      >
        {/* Mobile close button */}
        <button
          onClick={closeMobile}
          className="absolute top-4 right-3 z-10 lg:hidden p-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <Sidebar collapsed={collapsed} onNavigate={closeMobile} />
      </div>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* TOPBAR */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center gap-3 px-3 sm:px-5 shrink-0">
          {/* Hamburger — mobile: opens drawer, desktop: collapses sidebar */}
          <button
            onClick={() => {
              if (window.innerWidth >= 1024) {
                setCollapsed(c => !c)
              } else {
                setMobileOpen(o => !o)
              }
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Menú"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>

          {/* Search — hidden on smallest screens */}
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
            <button className="sm:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <Search className="w-5 h-5 text-gray-500" />
            </button>

            {/* Notifications */}
            <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <Bell className="w-5 h-5 text-gray-600" />
              <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
            </button>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center ml-1">
              <span className="text-white font-heading font-bold text-xs">A</span>
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
