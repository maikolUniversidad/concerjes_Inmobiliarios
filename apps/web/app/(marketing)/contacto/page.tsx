'use client'

import { useState } from 'react'
import { MapPin, Phone, Mail, Clock, Send, CheckCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'

const contactSchema = z.object({
  nombre: z.string().min(3, 'Mínimo 3 caracteres'),
  empresa: z.string().optional(),
  telefono: z.string().min(7, 'Teléfono inválido'),
  email: z.string().email('Email inválido'),
  servicio: z.string().optional(),
  mensaje: z.string().min(20, 'Mínimo 20 caracteres'),
})

type ContactForm = z.infer<typeof contactSchema>

const services = [
  'Aseo y Limpieza',
  'Cafetería',
  'Conserjería',
  'Jardinería',
  'Servicios Especiales',
  'Limpieza en Alturas',
  'Varios servicios',
]

export default function ContactoPage() {
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactForm>({ resolver: zodResolver(contactSchema) })

  async function onSubmit(data: ContactForm) {
    try {
      const res = await fetch('/api/contacto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error()
      setSent(true)
      reset()
      toast.success('¡Mensaje enviado! Nos comunicaremos pronto.')
    } catch {
      toast.error('Error al enviar. Intente de nuevo o llámenos directamente.')
    }
  }

  return (
    <>
      {/* Hero */}
      <div className="pt-28 pb-16 gradient-brand">
        <div className="container-max px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="font-heading font-bold text-5xl sm:text-6xl text-white mb-4">Contáctenos</h1>
          <p className="text-green-200 font-body text-xl max-w-xl mx-auto">
            Solicite una cotización gratuita. Respondemos en menos de 24 horas.
          </p>
        </div>
      </div>

      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="grid lg:grid-cols-5 gap-12">
            {/* Info — left */}
            <div className="lg:col-span-2 space-y-8">
              <div>
                <h2 className="font-heading font-bold text-2xl text-brand-gray-dark mb-6">
                  Información de contacto
                </h2>
                <ul className="space-y-5">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-brand-green/10 rounded-xl flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-brand-green" />
                    </div>
                    <div>
                      <p className="font-body font-semibold text-brand-gray-dark">Dirección</p>
                      <p className="font-body text-sm text-brand-gray-mid">
                        Carrera 19 # 166-34<br />
                        Toberín, Bogotá D.C., Colombia
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-brand-green/10 rounded-xl flex items-center justify-center shrink-0">
                      <Phone className="w-5 h-5 text-brand-green" />
                    </div>
                    <div>
                      <p className="font-body font-semibold text-brand-gray-dark">Teléfonos</p>
                      <a href="tel:+573208081399" className="font-body text-sm text-brand-gray-mid hover:text-brand-green block transition-colors">
                        +57 320 808 1399 (Comercial)
                      </a>
                      <a href="tel:6017926517" className="font-body text-sm text-brand-gray-mid hover:text-brand-green block transition-colors">
                        PBX: 601 792 6517
                      </a>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-brand-green/10 rounded-xl flex items-center justify-center shrink-0">
                      <Mail className="w-5 h-5 text-brand-green" />
                    </div>
                    <div>
                      <p className="font-body font-semibold text-brand-gray-dark">Email</p>
                      <a href="mailto:juridicaconserjesinmobiliarios@gmail.com" className="font-body text-sm text-brand-gray-mid hover:text-brand-green transition-colors break-all">
                        juridicaconserjesinmobiliarios@gmail.com
                      </a>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-brand-green/10 rounded-xl flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-brand-green" />
                    </div>
                    <div>
                      <p className="font-body font-semibold text-brand-gray-dark">Horario de atención</p>
                      <p className="font-body text-sm text-brand-gray-mid">
                        Lunes a Viernes: 7:00 AM – 6:00 PM<br />
                        Sábados: 7:00 AM – 1:00 PM
                      </p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Map placeholder */}
              <div className="aspect-[4/3] bg-gray-100 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
                <span className="text-3xl mb-2">🗺️</span>
                <p className="font-body text-sm text-gray-400">[ Google Maps embed ]</p>
                <p className="font-body text-xs text-gray-300 mt-1">Carrera 19 # 166-34, Bogotá</p>
              </div>
            </div>

            {/* Form — right */}
            <div className="lg:col-span-3">
              {sent ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-20 h-20 bg-brand-green/10 rounded-full flex items-center justify-center mb-6">
                    <CheckCircle className="w-10 h-10 text-brand-green" />
                  </div>
                  <h3 className="font-heading font-bold text-2xl text-brand-gray-dark mb-3">¡Mensaje enviado!</h3>
                  <p className="font-body text-brand-gray-mid">Nos comunicaremos con usted en menos de 24 horas hábiles.</p>
                  <button
                    onClick={() => setSent(false)}
                    className="mt-6 text-brand-green font-body font-semibold hover:underline text-sm"
                  >
                    Enviar otro mensaje
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                  <h2 className="font-heading font-bold text-2xl text-brand-gray-dark mb-6">
                    Solicitar cotización
                  </h2>
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                        Nombre completo *
                      </label>
                      <input
                        {...register('nombre')}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors"
                        placeholder="Ej: Carlos González"
                      />
                      {errors.nombre && <p className="text-red-500 text-xs mt-1">{errors.nombre.message}</p>}
                    </div>
                    <div>
                      <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                        Empresa
                      </label>
                      <input
                        {...register('empresa')}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors"
                        placeholder="Nombre de su empresa"
                      />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                        Teléfono *
                      </label>
                      <input
                        {...register('telefono')}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors"
                        placeholder="+57 300 000 0000"
                      />
                      {errors.telefono && <p className="text-red-500 text-xs mt-1">{errors.telefono.message}</p>}
                    </div>
                    <div>
                      <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                        Email *
                      </label>
                      <input
                        {...register('email')}
                        type="email"
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors"
                        placeholder="correo@empresa.com"
                      />
                      {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                      Servicio de interés
                    </label>
                    <select
                      {...register('servicio')}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors bg-white"
                    >
                      <option value="">Seleccionar servicio...</option>
                      {services.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                      Mensaje *
                    </label>
                    <textarea
                      {...register('mensaje')}
                      rows={5}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors resize-none"
                      placeholder="Cuéntenos sus necesidades, el tamaño de sus instalaciones, la frecuencia requerida del servicio..."
                    />
                    {errors.mensaje && <p className="text-red-500 text-xs mt-1">{errors.mensaje.message}</p>}
                  </div>
                  <p className="text-xs font-body text-gray-400">
                    * Al enviar este formulario, acepta nuestra política de tratamiento de datos personales conforme a la Ley 1581 de 2012.
                  </p>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2.5 bg-brand-green text-white font-body font-bold text-base px-8 py-4 rounded-xl hover:bg-brand-green-dark transition-all duration-200 disabled:opacity-60 shadow-md"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Enviar solicitud
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
