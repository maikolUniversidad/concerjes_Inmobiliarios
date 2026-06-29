import Link from 'next/link'
import { ArrowRight, Phone, Mail } from 'lucide-react'

export function CTASection() {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 gradient-brand" />
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `radial-gradient(circle at 25px 25px, white 2px, transparent 0), radial-gradient(circle at 75px 75px, white 2px, transparent 0)`,
          backgroundSize: '100px 100px',
        }}
      />

      <div className="container-max px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading font-bold text-4xl sm:text-5xl text-white mb-6 leading-tight">
            ¿Listo para transformar
            <br />
            <span className="text-green-300">su empresa?</span>
          </h2>
          <p className="text-green-100 font-body text-xl leading-relaxed mb-10">
            Contáctenos hoy y reciba una cotización personalizada sin costo.
            Nuestro equipo estará disponible para visitar sus instalaciones y
            proponer la mejor solución.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              href="/contacto"
              className="inline-flex items-center justify-center gap-2.5 bg-white text-brand-green font-body font-bold text-base px-8 py-4 rounded-xl hover:bg-green-50 transition-all duration-200 shadow-xl hover:shadow-2xl group"
            >
              Solicitar cotización gratis
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="https://wa.me/573208081399?text=Hola%2C%20me%20interesa%20conocer%20sus%20servicios"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2.5 bg-[#25D366] text-white font-body font-bold text-base px-8 py-4 rounded-xl hover:bg-[#20C157] transition-all duration-200 shadow-xl"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
              </svg>
              WhatsApp directo
            </a>
          </div>

          {/* Contact chips */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="tel:+573208081399"
              className="flex items-center gap-2.5 text-green-200 hover:text-white font-body text-sm transition-colors"
            >
              <Phone className="w-4 h-4" />
              +57 320 808 1399
            </a>
            <span className="hidden sm:block text-green-600">|</span>
            <a
              href="tel:6017926517"
              className="flex items-center gap-2.5 text-green-200 hover:text-white font-body text-sm transition-colors"
            >
              <Phone className="w-4 h-4" />
              PBX: 601 792 6517
            </a>
            <span className="hidden sm:block text-green-600">|</span>
            <a
              href="mailto:juridicaconserjesinmobiliarios@gmail.com"
              className="flex items-center gap-2.5 text-green-200 hover:text-white font-body text-sm transition-colors"
            >
              <Mail className="w-4 h-4" />
              juridicaconserjesinmobiliarios@gmail.com
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
