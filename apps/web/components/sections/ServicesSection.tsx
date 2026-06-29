'use client'

import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'

const services = [
  {
    id: 'aseo',
    icon: '🧹',
    title: 'Aseo y Limpieza',
    description:
      'Todas las labores de limpieza para conservación, protección y mantenimiento de instalaciones empresariales con protocolos de alta calidad.',
    features: ['Limpieza diaria y periódica', 'Desinfección especializada', 'Equipos de última tecnología'],
    color: 'from-green-500 to-emerald-600',
    bgColor: 'bg-green-50',
    accentColor: 'text-green-600',
  },
  {
    id: 'cafeteria',
    icon: '☕',
    title: 'Cafetería',
    description:
      'Proceso integral de aseo bajo protocolos de limpieza de alta calidad y eficiencia para áreas de cafetería y alimentación empresarial.',
    features: ['Limpieza de cocinas industriales', 'Manejo de residuos', 'Protocolo HACCP'],
    color: 'from-amber-500 to-orange-600',
    bgColor: 'bg-amber-50',
    accentColor: 'text-amber-600',
  },
  {
    id: 'conserjeria',
    icon: '🔑',
    title: 'Conserjería',
    description:
      'Conserjes especializados que dan cobertura y soluciones de trabajos auxiliares en la actividad diaria de su empresa o conjunto.',
    features: ['Control de acceso', 'Atención de visitantes', 'Gestión de correspondencia'],
    color: 'from-blue-500 to-indigo-600',
    bgColor: 'bg-blue-50',
    accentColor: 'text-blue-600',
  },
  {
    id: 'jardineria',
    icon: '🌿',
    title: 'Jardinería',
    description:
      'Portafolio completo de diseño, mantenimiento, cuidado y manejo de jardines, zonas verdes y zonas comunes de su propiedad.',
    features: ['Diseño paisajístico', 'Mantenimiento de zonas verdes', 'Poda y fumigación'],
    color: 'from-teal-500 to-green-600',
    bgColor: 'bg-teal-50',
    accentColor: 'text-teal-600',
  },
  {
    id: 'especiales',
    icon: '⚡',
    title: 'Servicios Especiales',
    description:
      'Limpieza especializada para áreas de difícil acceso o servicios específicos según el requerimiento y necesidad del cliente.',
    features: ['Post obra y construcción', 'Limpieza de eventos', 'Desinfección profunda'],
    color: 'from-purple-500 to-violet-600',
    bgColor: 'bg-purple-50',
    accentColor: 'text-purple-600',
  },
  {
    id: 'alturas',
    icon: '🏗️',
    title: 'Limpieza en Alturas',
    description:
      'Soluciones especializadas para espacios elevados con equipo capacitado y certificado en trabajo en alturas según normativa colombiana.',
    features: ['Certificados SENA altura', 'Fachadas y ventanales', 'Equipos de seguridad certificados'],
    color: 'from-red-500 to-rose-600',
    bgColor: 'bg-red-50',
    accentColor: 'text-red-600',
  },
]

export function ServicesSection() {
  return (
    <section id="servicios" className="section-padding bg-white">
      <div className="container-max">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 text-brand-green bg-brand-green/8 font-body font-semibold text-sm px-4 py-2 rounded-full mb-4">
            <Sparkles className="w-4 h-4" />
            Nuestro portafolio
          </div>
          <h2 className="font-heading font-bold text-4xl sm:text-5xl text-brand-gray-dark mb-4">
            Servicios que{' '}
            <span className="text-gradient">transforman</span>{' '}
            su empresa
          </h2>
          <p className="text-brand-gray-mid font-body text-lg leading-relaxed">
            Soluciones integrales adaptadas a las necesidades de cada cliente, con el respaldo
            de 36 años de experiencia y más de 1.069 colaboradores capacitados.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <div
              key={service.id}
              className="group relative bg-white border border-gray-100 rounded-2xl p-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 overflow-hidden"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Gradient accent top */}
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${service.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

              {/* Icon */}
              <div className={`w-16 h-16 ${service.bgColor} rounded-2xl flex items-center justify-center text-3xl mb-6 group-hover:scale-110 transition-transform duration-300`}>
                {service.icon}
              </div>

              {/* Content */}
              <h3 className="font-heading font-bold text-xl text-brand-gray-dark mb-3">
                {service.title}
              </h3>
              <p className="text-brand-gray-mid font-body text-sm leading-relaxed mb-5">
                {service.description}
              </p>

              {/* Features */}
              <ul className="space-y-2 mb-6">
                {service.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm font-body text-gray-600">
                    <span className={`w-1.5 h-1.5 rounded-full ${service.accentColor.replace('text-', 'bg-')}`} />
                    {f}
                  </li>
                ))}
              </ul>

              {/* Image slot */}
              <div className={`w-full h-32 ${service.bgColor} rounded-xl mb-5 flex items-center justify-center border-2 border-dashed border-current opacity-20`}>
                <span className="text-xs font-body text-gray-400">[ Foto del servicio ]</span>
              </div>

              <Link
                href={`/servicios#${service.id}`}
                className={`inline-flex items-center gap-2 ${service.accentColor} font-body font-semibold text-sm hover:gap-3 transition-all duration-200`}
              >
                Conocer más
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-14">
          <Link
            href="/servicios"
            className="inline-flex items-center gap-2.5 bg-brand-green text-white font-body font-bold px-8 py-4 rounded-xl hover:bg-brand-green-dark transition-all duration-200 shadow-md hover:shadow-lg"
          >
            Ver todos los servicios
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </section>
  )
}
