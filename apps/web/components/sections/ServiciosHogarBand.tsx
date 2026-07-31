'use client'

import Link from 'next/link'
import { ArrowRight, CalendarPlus, UserRound, Star, ImageIcon, ShieldCheck } from 'lucide-react'

const CHIPS = [
  { icono: '🧹', nombre: 'Aseo Regular' },
  { icono: '✨', nombre: 'Limpieza Profunda' },
  { icono: '🎉', nombre: 'Atención en Eventos' },
  { icono: '🍳', nombre: 'Servicio de Cocina' },
  { icono: '🌿', nombre: 'Jardín y Exteriores' },
  { icono: '🏗️', nombre: 'Post-Obra' },
]

const BENEFICIOS = [
  { icono: <CalendarPlus className="h-5 w-5" />, titulo: 'Agenda en línea', desc: 'Reserva el día y la hora que quieras' },
  { icono: <Star className="h-5 w-5" />, titulo: 'Seguimiento', desc: 'Sigue el estado de cada servicio' },
  { icono: <ImageIcon className="h-5 w-5" />, titulo: 'Galería y reseñas', desc: 'Mira trabajos reales y opiniones' },
  { icono: <ShieldCheck className="h-5 w-5" />, titulo: 'Personal verificado', desc: 'Con antecedentes y capacitación' },
]

export function ServiciosHogarBand() {
  return (
    <section className="section-padding bg-brand-green-bg/50">
      <div className="container-max">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Texto */}
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-green/10 px-4 py-2 text-sm font-body font-semibold text-brand-green">
              🏠 Nuevo · Para tu hogar
            </div>
            <h2 className="mb-4 font-heading text-4xl font-bold text-brand-gray-dark sm:text-5xl">
              ¿Necesitas limpieza <span className="text-gradient">en tu casa?</span>
            </h2>
            <p className="mb-6 max-w-xl font-body text-lg leading-relaxed text-brand-gray-mid">
              Los mismos concerjes de confianza que atienden empresas, ahora en tu hogar.
              Agenda aseo, limpieza profunda, eventos, cocina o jardín — y sigue todo desde tu portal.
            </p>

            {/* Chips de servicios */}
            <div className="mb-8 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <Link
                  key={c.nombre}
                  href={`/servicios-hogar/solicitar?servicio=${encodeURIComponent(c.nombre)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-body font-medium text-gray-700 transition-colors hover:border-brand-green hover:text-brand-green"
                >
                  <span>{c.icono}</span> {c.nombre}
                </Link>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/servicios-hogar/tienda"
                className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-brand-green px-8 py-4 font-body text-base font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-green-dark hover:shadow-xl"
              >
                <CalendarPlus className="h-5 w-5" />
                Explorar la tienda
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/servicios-hogar"
                className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-brand-green px-8 py-4 font-body text-base font-semibold text-brand-green transition-colors hover:bg-brand-green/5"
              >
                Ver servicios y precios
              </Link>
            </div>

            <p className="mt-4 font-body text-sm text-gray-500">
              <UserRound className="mr-1.5 inline h-4 w-4 align-[-3px] text-brand-green" />
              Explora y agenda sin registrarte. Crea tu cuenta solo si quieres <strong className="text-gray-700">seguimiento y direcciones guardadas</strong>.{' '}
              <Link href="/portal" className="font-semibold text-brand-green underline underline-offset-4">
                Mi portal
              </Link>
            </p>
          </div>

          {/* Beneficios */}
          <div className="grid grid-cols-2 gap-4">
            {BENEFICIOS.map((b) => (
              <div key={b.titulo} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
                  {b.icono}
                </div>
                <p className="mb-1 font-heading font-bold text-brand-gray-dark">{b.titulo}</p>
                <p className="font-body text-sm leading-snug text-brand-gray-mid">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
