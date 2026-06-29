'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Menu, X, ChevronDown, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'

const navLinks = [
  { label: 'Inicio', href: '/' },
  { label: 'Servicios', href: '/servicios' },
  { label: 'Nosotros', href: '/nosotros' },
  { label: 'Seguridad y Salud', href: '/seguridad-salud' },
  { label: 'Contacto', href: '/contacto' },
]

export function Header() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-white/95 backdrop-blur-md shadow-md py-2'
          : 'bg-transparent py-4'
      )}
    >
      <div className="container-max px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-brand-green rounded-lg flex items-center justify-center group-hover:bg-brand-green-mid transition-colors">
              <span className="text-white font-heading font-bold text-lg">CI</span>
            </div>
            <div>
              <span
                className={cn(
                  'font-heading font-bold text-lg leading-tight transition-colors',
                  scrolled ? 'text-brand-green' : 'text-white'
                )}
              >
                Conserjes
              </span>
              <span
                className={cn(
                  'font-heading font-bold text-lg leading-tight transition-colors ml-1',
                  scrolled ? 'text-brand-green-light' : 'text-green-300'
                )}
              >
                Inmobiliarios
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-4 py-2 rounded-lg font-body font-medium text-sm transition-all duration-200 hover:bg-white/10',
                  scrolled
                    ? 'text-brand-gray-dark hover:text-brand-green hover:bg-brand-green/5'
                    : 'text-white/90 hover:text-white hover:bg-white/10'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* CTA + Mobile toggle */}
          <div className="flex items-center gap-3">
            <a
              href="tel:+573208081399"
              className={cn(
                'hidden sm:flex items-center gap-2 text-sm font-body font-semibold transition-colors',
                scrolled ? 'text-brand-green' : 'text-white'
              )}
            >
              <Phone className="w-4 h-4" />
              320 808 1399
            </a>

            <Link
              href="/contacto"
              className="hidden md:inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white px-5 py-2.5 rounded-lg font-body font-semibold text-sm transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Cotizar ahora
            </Link>

            <button
              className="lg:hidden p-2 rounded-lg"
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Menú"
            >
              {isOpen ? (
                <X className={cn('w-6 h-6', scrolled ? 'text-gray-900' : 'text-white')} />
              ) : (
                <Menu className={cn('w-6 h-6', scrolled ? 'text-gray-900' : 'text-white')} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={cn(
          'lg:hidden transition-all duration-300 overflow-hidden',
          isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="bg-white border-t border-gray-100 shadow-lg">
          <nav className="container-max px-4 py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-3 rounded-lg text-gray-700 hover:text-brand-green hover:bg-brand-green/5 font-body font-medium transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/contacto"
              className="mt-2 text-center bg-brand-green text-white px-5 py-3 rounded-lg font-body font-semibold transition-colors hover:bg-brand-green-dark"
              onClick={() => setIsOpen(false)}
            >
              Cotizar ahora
            </Link>
            <a
              href="tel:+573208081399"
              className="flex items-center justify-center gap-2 text-brand-green font-body font-medium py-2"
            >
              <Phone className="w-4 h-4" />
              +57 320 808 1399
            </a>
          </nav>
        </div>
      </div>
    </header>
  )
}
