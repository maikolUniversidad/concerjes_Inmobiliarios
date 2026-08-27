'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, X, Phone, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

const navLinks = [
  { label: 'Inicio', href: '/' },
  { label: 'Servicios', href: '/servicios' },
  { label: 'Servicios del Hogar', href: '/servicios-hogar' },
  { label: 'Nosotros', href: '/nosotros' },
  { label: 'Seguridad y Salud', href: '/seguridad-salud' },
  { label: 'Trabaja con nosotros', href: '/registro-vacantes' },
  { label: 'Contacto', href: '/contacto' },
]

/**
 * Rutas cuyo primer bloque es un hero OSCURO a sangre completa que llega hasta
 * el borde superior de la ventana. Sólo en ellas el header se superpone en
 * transparente con el logo blanco.
 *
 * Cualquier ruta que no esté aquí usa el header SÓLIDO. Ese es el
 * comportamiento seguro por defecto: antes, el header asumía que todas las
 * páginas tenían un hero oscuro y en las que empiezan en blanco (tienda,
 * solicitar, servicios del hogar) el logo y el menú blancos quedaban invisibles
 * sobre fondo blanco hasta que uno hacía scroll.
 */
const RUTAS_HERO_OSCURO = new Set([
  '/',
  '/servicios',
  '/servicios-hogar',
  '/nosotros',
  '/seguridad-salud',
  '/contacto',
])

export function Header() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()

  // Se resuelve por ruta (no por efecto) para que el primer pintado ya sea el
  // correcto y no haya parpadeo del header al cargar.
  const puedeSuperponerse = RUTAS_HERO_OSCURO.has(pathname)
  const solido = !puedeSuperponerse || scrolled

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    handleScroll() // estado correcto si se entra a la página ya desplazada
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Cierra el menú móvil al navegar.
  useEffect(() => { setIsOpen(false) }, [pathname])

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        solido
          ? 'bg-white/95 backdrop-blur-md shadow-md py-2'
          : 'bg-transparent py-4'
      )}
    >
      <div className="container-max px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex shrink-0 items-center" aria-label="Conserjes Inmobiliarios — Inicio">
            <Image
              src={solido ? '/logo-horizontal.png' : '/logo-blanco.png'}
              alt="Conserjes Inmobiliarios"
              width={220}
              height={55}
              priority
              className="h-9 w-auto sm:h-10"
            />
          </Link>

          {/* Nav escritorio */}
          <nav className="hidden items-center gap-0.5 lg:flex">
            {navLinks.map((link) => {
              const activo = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={activo ? 'page' : undefined}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-2.5 py-2 font-body text-[13px] font-medium transition-all duration-200 xl:px-3 xl:text-sm',
                    solido
                      ? 'text-brand-gray-dark hover:bg-brand-green/5 hover:text-brand-green'
                      : 'text-white/90 hover:bg-white/10 hover:text-white',
                    activo && (solido ? 'text-brand-green' : 'text-white')
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>

          {/* CTA + menú móvil */}
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="tel:+573208081399"
              className={cn(
                'hidden items-center gap-2 whitespace-nowrap font-body text-sm font-semibold transition-colors xl:flex',
                solido ? 'text-brand-green' : 'text-white'
              )}
            >
              <Phone className="h-4 w-4" />
              320 808 1399
            </a>

            <Link
              href="/portal"
              className={cn(
                'hidden items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 font-body text-sm font-semibold transition-colors sm:inline-flex',
                solido ? 'text-brand-green hover:bg-brand-green/5' : 'text-white hover:bg-white/10'
              )}
            >
              <UserRound className="h-4 w-4" /> Mi portal
            </Link>

            <Link
              href="/servicios-hogar/solicitar"
              className="hidden whitespace-nowrap rounded-lg bg-brand-green px-4 py-2.5 font-body text-sm font-semibold text-white shadow-md transition-all duration-200 hover:bg-brand-green-dark hover:shadow-lg md:inline-flex md:items-center"
            >
              Cotizar ahora
            </Link>

            <button
              className="rounded-lg p-2 lg:hidden"
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Menú"
              aria-expanded={isOpen}
            >
              {isOpen ? (
                <X className={cn('h-6 w-6', solido ? 'text-gray-900' : 'text-white')} />
              ) : (
                <Menu className={cn('h-6 w-6', solido ? 'text-gray-900' : 'text-white')} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Menú móvil */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 lg:hidden',
          isOpen ? 'max-h-[32rem] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="border-t border-gray-100 bg-white shadow-lg">
          <nav className="container-max flex flex-col gap-1 px-4 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-4 py-3 font-body font-medium text-gray-700 transition-colors hover:bg-brand-green/5 hover:text-brand-green"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/portal"
              className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-brand-green px-5 py-3 font-body font-semibold text-brand-green transition-colors hover:bg-brand-green/5"
              onClick={() => setIsOpen(false)}
            >
              <UserRound className="h-4 w-4" /> Mi portal de cliente
            </Link>
            <Link
              href="/servicios-hogar/solicitar"
              className="rounded-lg bg-brand-green px-5 py-3 text-center font-body font-semibold text-white transition-colors hover:bg-brand-green-dark"
              onClick={() => setIsOpen(false)}
            >
              Cotizar ahora
            </Link>
            <a
              href="tel:+573208081399"
              className="flex items-center justify-center gap-2 py-2 font-body font-medium text-brand-green"
            >
              <Phone className="h-4 w-4" />
              +57 320 808 1399
            </a>
          </nav>
        </div>
      </div>
    </header>
  )
}
