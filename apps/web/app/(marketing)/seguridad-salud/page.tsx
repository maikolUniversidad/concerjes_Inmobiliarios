import type { Metadata } from 'next'
import { CheckCircle, Shield, Award, FileText } from 'lucide-react'
import { CTASection } from '@/components/sections/CTASection'

export const metadata: Metadata = {
  title: 'Seguridad y Salud',
  description:
    'Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST) de Conserjes Inmobiliarios Ltda. Certificaciones, protocolos y compromiso con el bienestar de nuestros colaboradores.',
}

const certifications = [
  { icon: '🏆', title: 'SG-SST', desc: 'Sistema de Gestión de Seguridad y Salud en el Trabajo implementado y auditado.' },
  { icon: '⛑️', title: 'Trabajo en Alturas', desc: 'Personal certificado por el SENA según Resolución 4272 de 2021.' },
  { icon: '🧪', title: 'Manipulación de Alimentos', desc: 'Certificación en prácticas seguras para el área de cafetería.' },
  { icon: '🚒', title: 'Brigada de Emergencias', desc: 'Brigadas capacitadas en primeros auxilios, evacuación y control de incendios.' },
]

const protocols = [
  'Uso correcto de Elementos de Protección Personal (EPP)',
  'Protocolos de bioseguridad y desinfección (post-COVID)',
  'Manejo seguro de productos químicos (fichas de seguridad SDS)',
  'Procedimientos seguros para trabajo en alturas',
  'Plan de evacuación y atención de emergencias',
  'Inspecciones de seguridad periódicas a equipos y herramientas',
  'Investigación de accidentes e incidentes laborales',
  'Programas de vigilancia epidemiológica',
]

export default function SeguridadSaludPage() {
  return (
    <>
      {/* Hero */}
      <div className="pt-28 pb-16 gradient-brand">
        <div className="container-max px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-5xl sm:text-6xl text-white mb-4">
            Seguridad y Salud
          </h1>
          <p className="text-green-200 font-body text-xl max-w-2xl mx-auto">
            El bienestar de nuestros colaboradores es nuestra prioridad número uno.
          </p>
        </div>
      </div>

      <section className="section-padding bg-white">
        <div className="container-max">
          {/* Intro */}
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-brand-gray-dark mb-6">
              Compromiso total con la seguridad
            </h2>
            <p className="text-brand-gray-mid font-body text-lg leading-relaxed">
              En Conserjes Inmobiliarios Ltda implementamos un Sistema de Gestión de Seguridad y
              Salud en el Trabajo (SG-SST) robusto, que protege a cada uno de nuestros colaboradores
              y garantiza servicios seguros para nuestros clientes.
            </p>
          </div>

          {/* Banner image slot */}
          <div className="aspect-[21/6] bg-gray-100 rounded-3xl border-2 border-dashed border-gray-200 flex items-center justify-center mb-16 shadow-lg">
            <div className="text-center text-gray-400">
              <span className="text-4xl block mb-2">🦺</span>
              <p className="font-body text-sm">[ Foto de EPP / Personal en campo ]</p>
              <p className="font-body text-xs mt-1 opacity-60">Recomendado: 1440×400px</p>
            </div>
          </div>

          {/* Certifications */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
            {certifications.map((c) => (
              <div key={c.title} className="bg-brand-green/5 border border-brand-green/15 rounded-2xl p-6 text-center hover:shadow-md transition-shadow">
                <span className="text-4xl block mb-3">{c.icon}</span>
                <h3 className="font-heading font-bold text-brand-gray-dark mb-2">{c.title}</h3>
                <p className="font-body text-sm text-brand-gray-mid leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>

          {/* Protocols */}
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="font-heading font-bold text-3xl text-brand-gray-dark mb-6">
                Nuestros protocolos
              </h2>
              <ul className="space-y-4">
                {protocols.map((p) => (
                  <li key={p} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-brand-green mt-0.5 shrink-0" />
                    <span className="font-body text-gray-700 text-base">{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Document slots */}
            <div>
              <h2 className="font-heading font-bold text-3xl text-brand-gray-dark mb-6">
                Documentos clave
              </h2>
              <div className="space-y-4">
                {[
                  'Política de Seguridad y Salud en el Trabajo',
                  'Manual de Procedimientos Seguros',
                  'Plan de Emergencias y Evacuación',
                  'Matriz de Identificación de Peligros (IPVR)',
                  'Programa de Vigilancia Epidemiológica',
                ].map((doc) => (
                  <div key={doc} className="flex items-center gap-4 bg-gray-50 rounded-xl p-4 hover:bg-brand-green/5 transition-colors cursor-pointer group">
                    <div className="w-10 h-10 bg-brand-green/10 rounded-lg flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-brand-green" />
                    </div>
                    <span className="font-body text-gray-700 text-sm group-hover:text-brand-green transition-colors">{doc}</span>
                    <span className="ml-auto text-xs font-body text-gray-400 bg-gray-200 px-2 py-1 rounded">PDF</span>
                  </div>
                ))}
              </div>
              <p className="text-xs font-body text-gray-400 mt-3">
                * Documentos disponibles previa solicitud formal.
              </p>
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </>
  )
}
