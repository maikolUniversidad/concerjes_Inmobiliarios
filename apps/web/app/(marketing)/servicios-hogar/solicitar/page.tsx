import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import SolicitudWizard from './SolicitudWizard'

export const metadata: Metadata = {
  title: 'Solicitar Servicio del Hogar | Conserjes Inmobiliarios',
  description: 'Agenda tu servicio de limpieza, eventos o cocina en pocos pasos. Respuesta en menos de 30 minutos.',
}

export default function SolicitarPage() {
  return (
    <div className="pt-20 min-h-screen bg-gray-50">
      <div className="container-max px-4 py-12">
        <Link
          href="/servicios-hogar"
          className="inline-flex items-center gap-2 text-sm font-body text-gray-500 hover:text-brand-green mb-8 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Volver a Servicios del Hogar
        </Link>

        <div className="max-w-2xl mx-auto bg-white rounded-3xl shadow-sm border border-gray-100 p-8 md:p-12">
          <div className="mb-10 text-center">
            <span className="text-4xl mb-3 block">🏠</span>
            <h1 className="font-heading font-bold text-2xl sm:text-3xl text-gray-900 mb-2">
              Solicita tu servicio
            </h1>
            <p className="font-body text-gray-500">
              Completa los datos y te contactamos en menos de 30 minutos.
            </p>
          </div>

          <Suspense fallback={
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 text-brand-green animate-spin" />
            </div>
          }>
            <SolicitudWizard />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
