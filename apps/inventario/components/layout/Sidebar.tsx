'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ChevronRight, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigation, isItemActive } from './navigation'

interface SidebarProps {
  collapsed?: boolean
  onNavigate?: () => void
}

export function Sidebar({ collapsed = false, onNavigate }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="h-full w-full bg-sidebar flex flex-col">

      {/* Brand */}
      <div className={cn(
        'flex items-center gap-3 px-4 py-4 border-b border-white/10 shrink-0',
        collapsed && 'lg:justify-center lg:px-2'
      )}>
        <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
          <span className="text-white font-heading font-bold text-sm">CI</span>
        </div>
        <div className={cn(collapsed && 'lg:hidden')}>
          <p className="text-white font-heading font-bold text-sm leading-tight">Conserjes</p>
          <p className="text-green-300 font-heading font-semibold text-xs leading-tight">Inventario</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-4 px-2">
        {navigation.map((group) => (
          <div key={group.id} className="mb-5">
            {/* Group label — hidden when collapsed on desktop */}
            <p className={cn(
              'text-green-400 font-body font-semibold text-xs uppercase tracking-widest px-3 mb-2',
              collapsed && 'lg:hidden'
            )}>
              {group.title}
            </p>

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = isItemActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group',
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'text-green-200 hover:bg-white/10 hover:text-white',
                        collapsed && 'lg:justify-center lg:px-2'
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className={cn('shrink-0', collapsed ? 'lg:w-5 lg:h-5 w-4 h-4' : 'w-4 h-4')} />
                      <span className={cn('font-body text-sm font-medium flex-1', collapsed && 'lg:hidden')}>
                        {item.label}
                      </span>
                      {isActive && !collapsed && (
                        <ChevronRight className="w-3 h-3 opacity-60 lg:block hidden" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-white/10 p-3 shrink-0">
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-green-200 hover:bg-white/10 hover:text-white transition-colors',
            collapsed && 'lg:justify-center'
          )}
          title={collapsed ? 'Cerrar sesión' : undefined}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span className={cn('font-body text-sm', collapsed && 'lg:hidden')}>
            Cerrar sesión
          </span>
        </button>
      </div>
    </aside>
  )
}
