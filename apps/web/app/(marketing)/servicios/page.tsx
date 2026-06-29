import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CheckCircle } from 'lucide-react'
import { CTASection } from '@/components/sections/CTASection'

export const metadata: Metadata = {
  title: 'Servicios',
  description:
    'Portafolio completo de servicios: aseo y limpieza, cafetería, conserjería, jardinería, servicios especiales y limpieza en alturas. Conserjes Inmobiliarios Ltda.',
}

const services = [
  {
    id: 'aseo',
    emoji: '🧹',
    title: 'Aseo y Limpieza',
    subtitle: 'Conservación y protección de sus instalaciones',
    description:
      'Ofrecemos todas las labores de limpieza para la conservación, protección y mantenimiento de instalaciones empresariales. Contamos con protocolos de alta calidad, equipos modernos y personal altamente capacitado.',
    details: [
      'Limpieza diaria de áreas administrativas y operativas',
      'Limpieza profunda periódica (mensual, trimestral)',
      'Desinfección y sanitización de superficies',
      'Limpieza de vidrios interiores y fachadas accesibles',
      'Cuidado de pisos (cera, pulido, cristalización)',
      'Manejo adecuado de residuos sólidos',
    ],
    videoSlot: true,
  },
  {
    id: 'cafeteria',
    emoji: '☕',
    title: 'Cafetería',
    subtitle: 'Higiene y eficiencia en áreas de alimentación',
    description:
      'Proceso integral de aseo bajo protocolos de limpieza de alta calidad y eficiencia. Nuestro equipo garantiza la higiene completa de cocinas, zonas de cafetería y áreas de preparación de alimentos.',
    details: [
      'Limpieza y desinfección de cocinas industriales',
      'Lavado y sanitización de utensilios',
      'Control de plagas y vectores',
      'Manejo de residuos orgánicos',
      'Cumplimiento de normas INVIMA',
      'Personal con manipulación de alimentos certificada',
    ],
    videoSlot: false,
  },
  {
    id: 'conserjeria',
    emoji: '🔑',
    title: 'Conserjería',
    subtitle: 'Gestión integral del acceso y auxiliares',
    description:
      'Conserjes especializados que dan cobertura y soluciones de trabajos auxiliares en la actividad diaria de su empresa o propiedad. Presencia permanente para garantizar la seguridad y buen funcionamiento.',
    details: [
      'Control de acceso y registro de visitantes',
      'Atención y orientación de usuarios',
      'Gestión de correspondencia y paquetería',
      'Supervisión de áreas comunes',
      'Apoyo en mudanzas y trasteos dentro del edificio',
      'Coordinación con servicios de seguridad',
    ],
    videoSlot: false,
  },
  {
    id: 'jardineria',
    emoji: '🌿',
    title: 'Jardinería',
    subtitle: 'Diseño y mantenimiento de zonas verdes',
    description:
      'Portafolio completo de diseño, mantenimiento, cuidado y manejo de jardines, zonas verdes y zonas comunes. Transformamos los espacios exteriores en entornos agradables y profesionales.',
    details: [
      'Diseño paisajístico de zonas verdes',
      'Mantenimiento periódico de jardines',
      'Poda de árboles y arbustos',
      'Siembra y trasplante de plantas',
      'Fumigación y control de plagas vegetales',
      'Manejo sostenible de residuos orgánicos',
    ],
    videoSlot: true,
  },
  {
    id: 'especiales',
    emoji: '⚡',
    title: 'Servicios Especiales',
    subtitle: 'Limpieza para necesidades específicas',
    description:
      'Limpieza especializada para áreas de difícil acceso o servicios específicos según el requerimiento y necesidad del cliente. Soluciones personalizadas para cada situación.',
    details: [
      'Limpieza post construcción y post obra',
      'Limpieza de eventos corporativos',
      'Desinfección por fumigación',
      'Lavado de tanques y cisternas',
      'Limpieza industrial profunda',
      'Manejo de residuos peligrosos (RESPEL)',
    ],
    videoSlot: false,
  },
  {
    id: 'alturas',
    emoji: '🏗️',
    title: 'Limpieza en Alturas',
    subtitle: 'Certificados por el SENA',
    description:
      'Soluciones especializadas para espacios elevados con equipo capacitado y certificado en trabajo en alturas según la Resolución 4272 de 2021 y normativa colombiana vigente.',
    details: [
      'Lavado de fachadas en vidrio y concreto',
      'Limpieza de ventanales en altura',
      'Mantenimiento de cubiertas y terrazas',
      'Personal certificado SENA trabajo en alturas',
      'Equipos de seguridad certificados (arneses, cuerdas)',
      'Seguros de accidentalidad y ARL',
    ],
    videoSlot: true,
  },
]

export default function ServiciosPage() {
  return (
    <>
      {/* Hero */}
      <div className="pt-28 pb-16 gradient-brand">
        <div className="container-max px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-5xl sm:text-6xl text-white mb-4">
            Nuestros Servicios
          </h1>
          <p className="text-green-200 font-body text-xl max-w-2xl mx-auto">
            Portafolio integral de soluciones de limpieza y mantenimiento para todo tipo de empresa.
          </p>
        </div>
      </div>

      {/* Services detail */}
      <section className="py-20 bg-white">
        <div className="container-max px-4 sm:px-6 lg:px-8">
          <div className="space-y-24">
            {services.map((service, index) => (
              <div
                key={service.id}
                id={service.id}
                className={`grid lg:grid-cols-2 gap-12 lg:gap-16 items-center scroll-mt-24 ${
                  index % 2 === 1 ? 'lg:grid-flow-col-dense' : ''
                }`}
              >
                {/* Image/Video slot */}
                <div className={index % 2 === 1 ? 'lg:col-start-2' : ''}>
                  <div className="aspect-[4/3] bg-gray-100 rounded-3xl overflow-hidden border-2 border-dashed border-gray-200 flex flex-col items-center justify-center shadow-lg">
                    <span className="text-6xl mb-4">{service.emoji}</span>
                    {service.videoSlot ? (
                      <div className="text-center text-gray-400">
                        <p className="font-body text-sm">[ Video del servicio ]</p>
                        <p className="font-body text-xs mt-1 opacity-60">MP4 recomendado · 16:9</p>
                      </div>
                    ) : (
                      <div className="text-center text-gray-400">
                        <p className="font-body text-sm">[ Foto del servicio ]</p>
                        <p className="font-body text-xs mt-1 opacity-60">800×600px recomendado</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className={index % 2 === 1 ? 'lg:col-start-1' : ''}>
                  <span className="text-4xl block mb-4">{service.emoji}</span>
                  <h2 className="font-heading font-bold text-3xl sm:text-4xl text-brand-gray-dark mb-2">
                    {service.title}
                  </h2>
                  <p className="text-brand-green font-body font-semibold mb-4">{service.subtitle}</p>
                  <p className="text-brand-gray-mid font-body text-lg leading-relaxed mb-6">
                    {service.description}
                  </p>
                  <ul className="space-y-3 mb-8">
                    {service.details.map((d) => (
                      <li key={d} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-brand-green mt-0.5 shrink-0" />
                        <span className="font-body text-gray-700">{d}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/contacto?servicio=${service.id}`}
                    className="inline-flex items-center gap-2.5 bg-brand-green text-white font-body font-bold px-7 py-3.5 rounded-xl hover:bg-brand-green-dark transition-all duration-200 shadow-md group"
                  >
                    Cotizar este servicio
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  )
}
