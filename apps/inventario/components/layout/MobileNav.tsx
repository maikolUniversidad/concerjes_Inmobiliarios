'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  navegacionVisible, moduleShortLabel, isItemActive, type NavModule,
} from './navigation'
import { usePermisos } from '@/components/permisos/PermisosProvider'

/**
 * Barra de navegación inferior para móvil (oculta en desktop `lg+`).
 *
 * - Fila de MÓDULOS fija en la parte inferior, distribuida para llenar el ancho.
 * - Al tocar un módulo con submódulos se despliega una bandeja superior,
 *   con scroll horizontal, con sus submódulos en forma de chips.
 * - Los módulos de un solo elemento navegan directamente.
 */
export function MobileNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { puede } = usePermisos()
  const [openId, setOpenId] = useState<string | null>(null)

  const navigation = navegacionVisible(puede)
  const activeModule: NavModule | undefined = navigation.find((mod) =>
    mod.items.some((item) => isItemActive(pathname, item.href)),
  )

  // Al cambiar de ruta: cerrar la bandeja y sincronizar el módulo activo.
  useEffect(() => {
    setOpenId(null)
  }, [pathname])

  const openModule = openId
    ? navigation.find((m) => m.id === openId)
    : undefined

  const handleModuleTap = (id: string) => {
    const mod = navigation.find((m) => m.id === id)
    if (!mod) return
    // Módulo de un solo submódulo → navegar directo.
    if (mod.items.length === 1) {
      setOpenId(null)
      router.push(mod.items[0].href)
      return
    }
    // Módulo con submódulos → alternar bandeja.
    setOpenId((cur) => (cur === id ? null : id))
  }

  return (
    <>
      {/* Backdrop para cerrar la bandeja al tocar fuera */}
      {openModule && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={() => setOpenId(null)}
          aria-hidden
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        {/* ── Bandeja de submódulos ── */}
        {openModule && openModule.items.length > 1 && (
          <div className="bg-white border-t border-gray-200 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between px-4 pt-2.5">
              <p className="font-heading font-semibold text-xs text-gray-500 uppercase tracking-wider">
                {openModule.title}
              </p>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 py-2.5 [scroll-padding-left:0.75rem]">
              {openModule.items.map((item) => {
                const active = isItemActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpenId(null)}
                    className={cn(
                      'flex items-center gap-2 shrink-0 rounded-full border px-3.5 py-2 transition-colors',
                      active
                        ? 'bg-brand-green border-brand-green text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-700 active:bg-gray-100'
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="font-body text-sm font-medium whitespace-nowrap">
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Barra de módulos ── */}
        <nav
          className="bg-sidebar border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
          aria-label="Navegación principal"
        >
          <div className="flex items-stretch gap-0.5 px-1.5 py-1">
            {navigation.map((mod) => {
              const isActive = activeModule?.id === mod.id
              const isOpen = openId === mod.id
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => handleModuleTap(mod.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors',
                    isActive || isOpen
                      ? 'bg-white/20 text-white'
                      : 'text-green-200 active:bg-white/10'
                  )}
                >
                  <mod.icon className="w-5 h-5 shrink-0" />
                  <span className="font-body text-[11px] font-medium leading-none truncate max-w-full">
                    {moduleShortLabel[mod.id] ?? mod.title}
                  </span>
                </button>
              )
            })}
          </div>
        </nav>
      </div>
    </>
  )
}
