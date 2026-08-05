'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  navegacionVisible, moduleShortLabel, isItemActive, type NavModule,
} from './navigation'
import { usePermisos } from '@/components/permisos/PermisosProvider'

// Cuántos módulos se muestran como pestañas antes de agrupar el resto en "Más".
// Si el rol ve pocos módulos, se muestran todos (no aparece "Más").
const MAX_PRIMARIOS = 4
const MAS_ID = '__mas__'

/**
 * Barra de navegación inferior para móvil (oculta en desktop `lg+`).
 *
 * - Muestra hasta MAX_PRIMARIOS módulos + un botón "Más" con el resto (evita que
 *   la barra se sature cuando hay muchos módulos: se apretaban e ilegibles).
 * - Al tocar un módulo con submódulos se despliega una bandeja superior con
 *   scroll horizontal; los de un solo elemento navegan directo.
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

  // ¿Hay que agrupar en "Más"? Solo si hay más módulos que espacios cómodos.
  const usarMas = navigation.length > MAX_PRIMARIOS + 1
  const primarios = usarMas ? navigation.slice(0, MAX_PRIMARIOS) : navigation
  const resto = usarMas ? navigation.slice(MAX_PRIMARIOS) : []
  const activoEnResto = resto.some((m) => m.id === activeModule?.id)

  useEffect(() => { setOpenId(null) }, [pathname])

  const handleModuleTap = (id: string) => {
    if (id === MAS_ID) { setOpenId((cur) => (cur === MAS_ID ? null : MAS_ID)); return }
    const mod = navigation.find((m) => m.id === id)
    if (!mod) return
    if (mod.items.length === 1) { setOpenId(null); router.push(mod.items[0].href); return }
    setOpenId((cur) => (cur === id ? null : id))
  }

  const openModule = openId && openId !== MAS_ID ? navigation.find((m) => m.id === openId) : undefined
  const bandejaAbierta = !!openModule || openId === MAS_ID

  const Tab = ({ id, icon: Icon, label, active }: {
    id: string; icon: NavModule['icon']; label: string; active: boolean
  }) => (
    <button
      type="button"
      onClick={() => handleModuleTap(id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors',
        active || openId === id ? 'bg-white/20 text-white' : 'text-green-200 active:bg-white/10',
      )}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="font-body text-[11px] font-medium leading-none truncate max-w-full">{label}</span>
    </button>
  )

  return (
    <>
      {bandejaAbierta && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setOpenId(null)} aria-hidden />
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        {/* ── Bandeja: submódulos de un módulo, o la lista de "Más" ── */}
        {openModule && openModule.items.length > 1 && (
          <Bandeja titulo={openModule.title}>
            {openModule.items.map((item) => {
              const active = isItemActive(pathname, item.href)
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpenId(null)}
                  className={cn(
                    'flex items-center gap-2 shrink-0 rounded-full border px-3.5 py-2 transition-colors',
                    active ? 'bg-brand-green border-brand-green text-white' : 'bg-gray-50 border-gray-200 text-gray-700 active:bg-gray-100',
                  )}>
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className="font-body text-sm font-medium whitespace-nowrap">{item.label}</span>
                </Link>
              )
            })}
          </Bandeja>
        )}

        {openId === MAS_ID && (
          <Bandeja titulo="Más módulos">
            {resto.map((mod) => {
              const active = activeModule?.id === mod.id
              return (
                <button key={mod.id} type="button" onClick={() => handleModuleTap(mod.id)}
                  className={cn(
                    'flex items-center gap-2 shrink-0 rounded-full border px-3.5 py-2 transition-colors',
                    active ? 'bg-brand-green border-brand-green text-white' : 'bg-gray-50 border-gray-200 text-gray-700 active:bg-gray-100',
                  )}>
                  <mod.icon className="w-4 h-4 shrink-0" />
                  <span className="font-body text-sm font-medium whitespace-nowrap">{mod.title}</span>
                </button>
              )
            })}
          </Bandeja>
        )}

        {/* ── Barra de módulos ── */}
        <nav className="bg-sidebar border-t border-white/10 pb-[env(safe-area-inset-bottom)]" aria-label="Navegación principal">
          <div className="flex items-stretch gap-0.5 px-1.5 py-1">
            {primarios.map((mod) => (
              <Tab key={mod.id} id={mod.id} icon={mod.icon} label={moduleShortLabel[mod.id] ?? mod.title}
                active={activeModule?.id === mod.id} />
            ))}
            {usarMas && (
              <Tab id={MAS_ID} icon={MoreHorizontal} label="Más" active={activoEnResto} />
            )}
          </div>
        </nav>
      </div>
    </>
  )
}

function Bandeja({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border-t border-gray-200 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between px-4 pt-2.5">
        <p className="font-heading font-semibold text-xs text-gray-500 uppercase tracking-wider">{titulo}</p>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 py-2.5 [scroll-padding-left:0.75rem]">
        {children}
      </div>
    </div>
  )
}
