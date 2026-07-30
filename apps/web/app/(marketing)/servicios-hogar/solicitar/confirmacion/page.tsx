import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Phone, MessageCircle, Clock, Home } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Solicitud Recibida | Conserjes Inmobiliarios',
}

export default function ConfirmacionPage() {
  return (
    <div className="pt-20 min-h-screen bg-gray-50 flex items-center">
      <div className="container-max px-4 py-16 w-full">
        <div className="max-w-lg mx-auto text-center">

          {/* Ícono de éxito */}
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 className="w-12 h-12 text-brand-green" />
          </div>

          <h1 className="font-heading font-bold text-3xl text-gray-900 mb-4">
            ¡Solicitud recibida!
          </h1>
          <p className="font-body text-gray-600 text-lg mb-10 leading-relaxed">
            Hemos recibido tu solicitud correctamente. Un asesor de
            <strong className="text-gray-800"> Conserjes Inmobiliarios</strong> te contactará
            en los próximos <strong className="text-brand-green">30 minutos</strong> para
            confirmar el servicio y darte el precio final.
          </p>

          {/* Qué sigue */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-10 text-left space-y-4">
            <p className="font-heading font-bold text-gray-900 mb-3">¿Qué sigue?</p>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-brand-green rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-white font-bold text-sm">1</span>
              </div>
              <div>
                <p className="font-body font-semibold text-gray-800 text-sm">Confirmación de disponibilidad</p>
                <p className="font-body text-gray-500 text-sm">Te llamaremos para confirmar el horario y asignar al concierje disponible.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-brand-green rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-white font-bold text-sm">2</span>
              </div>
              <div>
                <p className="font-body font-semibold text-gray-800 text-sm">Precio y pago</p>
                <p className="font-body text-gray-500 text-sm">Te informamos el precio final. Puedes pagar el día del servicio en efectivo o transferencia.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-brand-green rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-white font-bold text-sm">3</span>
              </div>
              <div>
                <p className="font-body font-semibold text-gray-800 text-sm">Servicio impecable</p>
                <p className="font-body text-gray-500 text-sm">Nuestro personal llega puntual y listo para trabajar con los más altos estándares.</p>
              </div>
            </div>
          </div>

          {/* Datos de contacto */}
          <div className="bg-green-50 rounded-2xl border border-green-100 p-5 mb-8 text-left">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-brand-green" />
              <p className="font-body font-semibold text-gray-800 text-sm">¿No te contactamos en 30 min?</p>
            </div>
            <p className="font-body text-gray-600 text-sm mb-3">Comunícate directamente con nosotros:</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a href="tel:+573208081399"
                className="flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-brand-green-dark transition-colors">
                <Phone className="w-4 h-4" /> +57 320 808 1399
              </a>
              <a href="https://wa.me/573208081399" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#25D366] text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:opacity-90 transition-opacity">
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </a>
            </div>
          </div>

          {/* Volver */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/servicios-hogar"
              className="flex items-center justify-center gap-2 border-2 border-gray-200 text-gray-700 font-body font-semibold px-6 py-3 rounded-xl hover:border-gray-300 transition-colors">
              Ver más servicios
            </Link>
            <Link href="/"
              className="flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold px-6 py-3 rounded-xl hover:bg-brand-green-dark transition-colors">
              <Home className="w-4 h-4" /> Ir al inicio
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
