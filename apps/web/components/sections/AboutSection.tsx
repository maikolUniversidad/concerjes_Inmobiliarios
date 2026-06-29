import Link from 'next/link'
import { ArrowRight, Award, Heart, Shield, Leaf } from 'lucide-react'

const principles = [
  {
    icon: Shield,
    title: 'Confiabilidad',
    description: 'Prácticas que garantizan la idoneidad del Talento Humano y el cumplimiento de compromisos con todas las partes de interés.',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    icon: Heart,
    title: 'Valor Compartido',
    description: 'Beneficio y desarrollo permanente de clientes internos y externos, e interacción positiva con la comunidad.',
    color: 'text-rose-600 bg-rose-50',
  },
  {
    icon: Leaf,
    title: 'Trascendencia',
    description: 'Mejoramiento permanente de procesos, respeto al entorno y bienestar común. Sostenibilidad hacia futuras generaciones.',
    color: 'text-green-600 bg-green-50',
  },
]

export function AboutSection() {
  return (
    <section className="section-padding bg-brand-green/3">
      <div className="container-max">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left — Image + card */}
          <div className="relative">
            {/* Main image placeholder */}
            <div className="aspect-[4/3] bg-gray-100 rounded-3xl overflow-hidden shadow-2xl border-2 border-dashed border-gray-200 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-5xl mb-3">📸</div>
                <p className="font-body text-sm">[ Foto corporativa del equipo ]</p>
                <p className="font-body text-xs mt-1 opacity-60">Recomendado: 800×600px</p>
              </div>
            </div>

            {/* Video badge */}
            <div className="absolute -bottom-6 -right-6 bg-white rounded-2xl p-5 shadow-xl border border-gray-100 max-w-[200px]">
              <div className="w-12 h-12 bg-brand-green/10 rounded-xl flex items-center justify-center mb-3">
                <Award className="w-6 h-6 text-brand-green" />
              </div>
              <p className="font-heading font-bold text-2xl text-brand-gray-dark">36+</p>
              <p className="font-body text-sm text-brand-gray-mid">Años de trayectoria</p>
            </div>

            {/* Video slot */}
            <div className="absolute -top-4 -left-4 w-28 h-28 bg-brand-green rounded-2xl shadow-lg overflow-hidden border-2 border-dashed border-white/40 flex items-center justify-center">
              <div className="text-center text-white/60 text-xs font-body p-2">
                🎥<br />Video corporativo
              </div>
            </div>
          </div>

          {/* Right — Content */}
          <div>
            <div className="inline-flex items-center gap-2 text-brand-green bg-brand-green/8 font-body font-semibold text-sm px-4 py-2 rounded-full mb-6">
              <Award className="w-4 h-4" />
              Quiénes somos
            </div>

            <h2 className="font-heading font-bold text-4xl sm:text-5xl text-brand-gray-dark mb-6 leading-tight">
              Más de tres décadas{' '}
              <span className="text-gradient">transformando</span>{' '}
              espacios
            </h2>

            <p className="text-brand-gray-mid font-body text-lg leading-relaxed mb-5">
              Fundados el 6 de abril de 1990, Conserjes Inmobiliarios Ltda ha crecido hasta
              convertirse en una de las empresas líderes del sector en Colombia, con presencia
              en Bogotá y todo el territorio nacional.
            </p>

            <p className="text-brand-gray-mid font-body text-base leading-relaxed mb-8">
              Nuestra misión es brindar soluciones de limpieza integral, mantenimiento locativo
              y cafetería, creando valor a través del manejo eficiente del recurso humano y el
              uso de insumos amigables con el planeta.
            </p>

            {/* Principles */}
            <div className="space-y-4 mb-8">
              {principles.map((p) => (
                <div key={p.title} className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl ${p.color} flex items-center justify-center shrink-0 mt-0.5`}>
                    <p.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-heading font-semibold text-brand-gray-dark mb-1">{p.title}</h4>
                    <p className="font-body text-sm text-brand-gray-mid leading-relaxed">{p.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/nosotros"
              className="inline-flex items-center gap-2.5 bg-brand-green text-white font-body font-bold px-7 py-3.5 rounded-xl hover:bg-brand-green-dark transition-all duration-200 shadow-md group"
            >
              Conocer nuestra historia
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
