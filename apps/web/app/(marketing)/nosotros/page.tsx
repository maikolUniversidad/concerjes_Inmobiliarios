import type { Metadata } from 'next'
import { CTASection } from '@/components/sections/CTASection'

export const metadata: Metadata = {
  title: 'Nosotros',
  description:
    'Conoce la historia, misión, visión y principios corporativos de Conserjes Inmobiliarios Ltda. 36 años de trayectoria en Colombia.',
}

const timeline = [
  { year: '1990', event: 'Fundación de Conserjes Inmobiliarios Ltda el 6 de abril en Bogotá D.C.' },
  { year: '2000', event: 'Expansión a más de 100 contratos activos en Bogotá y municipios cercanos.' },
  { year: '2010', event: 'Certificación en Sistema de Gestión de Seguridad y Salud en el Trabajo.' },
  { year: '2015', event: 'Vinculación a grupo corporativo Vigías de Colombia. Plataforma de capacitaciones.' },
  { year: '2020', event: 'Implementación de protocolo COVID-19. Servicio ininterrumpido durante pandemia.' },
  { year: '2024', event: 'Más de 1.069 colaboradores activos. Ventas entre COP $20.000M y $100.000M.' },
  { year: '2026', event: 'Lanzamiento de plataforma digital y módulo de inventarios con IA.' },
]

export default function NosotrosPage() {
  return (
    <>
      {/* Hero */}
      <div className="pt-28 pb-16 gradient-brand relative overflow-hidden">
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: `radial-gradient(circle at 25px 25px, white 2px, transparent 0)`, backgroundSize: '50px 50px' }}
        />
        <div className="container-max px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="font-heading font-bold text-5xl sm:text-6xl text-white mb-4">Quiénes somos</h1>
          <p className="text-green-200 font-body text-xl max-w-2xl mx-auto">
            Tres décadas construyendo confianza y transformando espacios en Colombia.
          </p>
        </div>
      </div>

      {/* Mission & Vision */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="grid md:grid-cols-2 gap-8 mb-20">
            <div className="bg-brand-green/5 border border-brand-green/15 rounded-3xl p-10">
              <div className="w-12 h-12 bg-brand-green rounded-2xl flex items-center justify-center mb-5">
                <span className="text-white text-xl">🎯</span>
              </div>
              <h2 className="font-heading font-bold text-2xl text-brand-gray-dark mb-4">Misión</h2>
              <p className="text-brand-gray-mid font-body text-base leading-relaxed">
                Brindar soluciones a las necesidades de limpieza integral, mantenimiento locativo, aseo y cafetería;
                creando valor a través del manejo eficiente y eficaz del recurso humano, fomentando el uso de insumos
                amigables con el planeta y estableciendo un entorno favorable para el crecimiento con calidad, que
                incluya a todos nuestros colaboradores.
              </p>
            </div>
            <div className="bg-brand-orange/5 border border-brand-orange/15 rounded-3xl p-10">
              <div className="w-12 h-12 bg-brand-orange rounded-2xl flex items-center justify-center mb-5">
                <span className="text-white text-xl">🔭</span>
              </div>
              <h2 className="font-heading font-bold text-2xl text-brand-gray-dark mb-4">Visión</h2>
              <p className="text-brand-gray-mid font-body text-base leading-relaxed">
                Ser reconocidos como una de las empresas líderes en Colombia en la prestación de servicios de aseo,
                cafetería y mantenimiento, ofreciendo productos de óptima calidad con una atención de alto nivel.
                Buscamos que, mediante el mejoramiento permanente de nuestros procesos, el respeto a nuestro entorno
                y el bienestar común, nuestra organización no solo sea sostenible, sino que trascienda en la cultura
                de futuras generaciones.
              </p>
            </div>
          </div>

          {/* Principles */}
          <div className="text-center mb-12">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-brand-gray-dark">
              Principios corporativos
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {[
              { icon: '🌱', title: 'Trascendencia', desc: 'Mejoramiento permanente de procesos, respeto al entorno, bienestar común. Sostenibilidad hacia futuras generaciones.', color: 'bg-green-50 border-green-200' },
              { icon: '🤝', title: 'Valor Compartido', desc: 'Beneficio y desarrollo permanente de clientes internos y externos, e interacción positiva con la comunidad.', color: 'bg-blue-50 border-blue-200' },
              { icon: '🛡️', title: 'Confiabilidad', desc: 'Prácticas que garantizan la idoneidad del Talento Humano y el cumplimiento de compromisos con todas las partes de interés.', color: 'bg-amber-50 border-amber-200' },
            ].map((p) => (
              <div key={p.title} className={`${p.color} border rounded-3xl p-8 text-center`}>
                <span className="text-5xl block mb-4">{p.icon}</span>
                <h3 className="font-heading font-bold text-xl text-brand-gray-dark mb-3">{p.title}</h3>
                <p className="font-body text-brand-gray-mid text-sm leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>

          {/* Team photo slot */}
          <div className="mb-20">
            <h2 className="font-heading font-bold text-3xl text-center text-brand-gray-dark mb-8">
              Nuestro equipo
            </h2>
            <div className="aspect-video bg-gray-100 rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center max-w-4xl mx-auto shadow-lg">
              <span className="text-5xl mb-4">👥</span>
              <p className="font-body text-gray-400">[ Foto o video del equipo corporativo ]</p>
              <p className="font-body text-xs text-gray-300 mt-1">Recomendado: 1280×720px o video MP4</p>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <h2 className="font-heading font-bold text-3xl text-center text-brand-gray-dark mb-12">
              Nuestra historia
            </h2>
            <div className="relative max-w-3xl mx-auto">
              <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-brand-green/20" />
              <div className="space-y-8">
                {timeline.map((item) => (
                  <div key={item.year} className="relative flex gap-6 pl-20">
                    <div className="absolute left-4 w-9 h-9 bg-brand-green rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-white font-heading font-bold text-xs">{item.year.slice(2)}</span>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex-1 hover:shadow-md transition-shadow">
                      <span className="text-brand-green font-heading font-bold text-lg block mb-1">{item.year}</span>
                      <p className="font-body text-gray-600 text-sm leading-relaxed">{item.event}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </>
  )
}
