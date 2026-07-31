import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Star, Phone, Clock, Shield, Award, ChevronRight, Users, UserRound, CalendarCheck, Bell, MapPin } from 'lucide-react'
import { GaleriaServicios } from '@/components/servicios-hogar/GaleriaServicios'
import { ResenasClientes } from '@/components/servicios-hogar/ResenasClientes'

export const metadata: Metadata = {
  title: 'Servicios del Hogar | Conserjes Inmobiliarios',
  description: 'Contrata servicios de aseo, limpieza profunda, atención en eventos y más. Personal capacitado y de confianza directamente en tu hogar.',
}

const SERVICIOS = [
  {
    icono: '🧹',
    nombre: 'Aseo Regular',
    descripcion: 'Limpieza general del hogar: salas, habitaciones, baños y cocina.',
    color: 'from-green-500 to-emerald-600',
    bg: 'bg-green-50',
    border: 'border-green-100',
    tarifas: [
      { nombre: '2 horas', precio: 55000 },
      { nombre: 'Medio día', precio: 95000 },
      { nombre: 'Día completo', precio: 170000 },
    ],
    incluye: ['Barrido y trapeado','Limpieza de baños','Desempolvado','Cocina','Organización'],
  },
  {
    icono: '✨',
    nombre: 'Limpieza Profunda',
    descripcion: 'Limpieza detallada con productos especializados, áreas de difícil acceso y electrodomésticos.',
    color: 'from-blue-500 to-indigo-600',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    tarifas: [
      { nombre: 'Medio día', precio: 140000 },
      { nombre: 'Día completo', precio: 250000 },
      { nombre: '2 personas - Medio día', precio: 240000 },
    ],
    incluye: ['Todo el aseo regular','Interior de electrodomésticos','Lavado de vidrios','Desinfección profunda','Closets y cajones'],
  },
  {
    icono: '🏗️',
    nombre: 'Post-Obra',
    descripcion: 'Limpieza especializada después de remodelaciones: polvo fino, residuos y acabados.',
    color: 'from-orange-500 to-amber-600',
    bg: 'bg-orange-50',
    border: 'border-orange-100',
    tarifas: [
      { nombre: 'Cotización personalizada', precio: null },
    ],
    incluye: ['Retiro de polvo de obra','Pisos nuevos','Ventanas','Pintura en superficies','Aspirado de residuos'],
  },
  {
    icono: '🎉',
    nombre: 'Atención en Eventos',
    descripcion: 'Personal capacitado para atender invitados: servicio de mesa, copas y limpieza durante el evento.',
    color: 'from-purple-500 to-violet-600',
    bg: 'bg-purple-50',
    border: 'border-purple-100',
    tarifas: [
      { nombre: '4h · 1 persona', precio: 160000 },
      { nombre: '8h · 1 persona', precio: 280000 },
      { nombre: '8h · 2 personas', precio: 480000 },
    ],
    incluye: ['Servicio de mesa','Atención a invitados','Mantenimiento durante evento','Limpieza posterior','Uniforme formal'],
  },
  {
    icono: '🍳',
    nombre: 'Servicio de Cocina',
    descripcion: 'Preparación y servicio de alimentos para el hogar o pequeñas reuniones.',
    color: 'from-amber-500 to-yellow-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    tarifas: [
      { nombre: 'Medio día', precio: 120000 },
      { nombre: 'Día completo', precio: 210000 },
    ],
    incluye: ['Preparación de alimentos','Presentación de platos','Servicio a la mesa','Limpieza de cocina','Menú acordado'],
  },
  {
    icono: '🌿',
    nombre: 'Jardín y Exteriores',
    descripcion: 'Cuidado de plantas, poda, limpieza de terrazas, balcones y áreas exteriores.',
    color: 'from-emerald-500 to-teal-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    tarifas: [
      { nombre: '2 horas', precio: 70000 },
      { nombre: 'Medio día', precio: 120000 },
    ],
    incluye: ['Corte de césped','Poda de plantas','Terrazas y balcones','Riego','Retiro de hojas'],
  },
]

const PASOS = [
  { num: '1', titulo: 'Elige el servicio', desc: 'Selecciona el tipo de servicio y el horario que más te convenga.' },
  { num: '2', titulo: 'Agenda y confirma', desc: 'Llena tus datos, dirección y fecha. Recibes confirmación en minutos.' },
  { num: '3', titulo: 'Disfruta tu hogar', desc: 'Nuestro personal llega puntual y listo para trabajar con los más altos estándares.' },
]

const GARANTIAS = [
  { icono: <Shield className="w-6 h-6" />, titulo: 'Personal verificado', desc: 'Todos nuestros concerjes pasan por verificación de antecedentes y capacitación.' },
  { icono: <Award className="w-6 h-6" />, titulo: '36 años de experiencia', desc: 'Somos líderes en servicios domésticos y de conserjería en Colombia.' },
  { icono: <Star className="w-6 h-6" />, titulo: 'Satisfacción garantizada', desc: 'Si no quedas satisfecho, regresamos sin costo adicional.' },
  { icono: <Clock className="w-6 h-6" />, titulo: 'Puntualidad', desc: 'Nuestro personal llega en el horario acordado, siempre.' },
]

function fmt(p: number | null) {
  if (p === null) return 'A consultar'
  return `$${p.toLocaleString('es-CO')} COP`
}

export default function ServiciosHogarPage() {
  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="gradient-hero text-white py-24 px-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        <div className="container-max relative text-center">
          <span className="inline-block bg-white/15 backdrop-blur-sm text-white text-sm font-body font-semibold px-4 py-1.5 rounded-full mb-6">
            🏠 Servicios del Hogar
          </span>
          <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl mb-6 leading-tight">
            Tu hogar impecable,<br />
            <span className="text-green-300">sin preocupaciones</span>
          </h1>
          <p className="text-white/80 text-lg sm:text-xl max-w-2xl mx-auto mb-10 font-body">
            Contrata servicios de aseo, limpieza profunda, atención en eventos y más.
            Personal capacitado, verificado y de confianza de <strong className="text-white">Conserjes Inmobiliarios</strong>.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/servicios-hogar/tienda"
              className="inline-flex items-center justify-center gap-2 bg-white text-brand-green font-body font-bold text-base px-8 py-4 rounded-xl shadow-lg hover:shadow-xl hover:bg-green-50 transition-all"
            >
              🛒 Explorar la tienda <ChevronRight className="w-5 h-5" />
            </Link>
            <Link
              href="/servicios-hogar/solicitar"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-body font-semibold text-base px-8 py-4 rounded-xl transition-all"
            >
              Solicitar servicio
            </Link>
          </div>
          <div className="mt-12 flex flex-wrap justify-center gap-8 text-white/80 font-body text-sm">
            <div className="flex items-center gap-2"><Users className="w-4 h-4" /> +1.069 concerjes</div>
            <div className="flex items-center gap-2"><Shield className="w-4 h-4" /> Personal verificado</div>
            <div className="flex items-center gap-2"><Star className="w-4 h-4" /> 36 años de experiencia</div>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="container-max">
          <div className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              ¿Cómo funciona?
            </h2>
            <p className="text-gray-500 font-body text-lg max-w-xl mx-auto">
              Agenda tu servicio en 3 simples pasos
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {PASOS.map((p) => (
              <div key={p.num} className="text-center">
                <div className="w-16 h-16 bg-brand-green rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-green-200">
                  <span className="text-white font-heading font-bold text-2xl">{p.num}</span>
                </div>
                <h3 className="font-heading font-bold text-xl text-gray-900 mb-3">{p.titulo}</h3>
                <p className="text-gray-500 font-body leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Catálogo de servicios */}
      <section id="servicios" className="py-20 px-4">
        <div className="container-max">
          <div className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Nuestros servicios
            </h2>
            <p className="text-gray-500 font-body text-lg max-w-xl mx-auto">
              Escoge el servicio que necesitas y el horario que más te convenga
            </p>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {SERVICIOS.map((s) => (
              <div key={s.nombre} className={`rounded-2xl border ${s.border} ${s.bg} overflow-hidden flex flex-col`}>
                {/* Card header */}
                <div className={`bg-gradient-to-r ${s.color} p-5`}>
                  <div className="flex items-center gap-3">
                    <span className="text-4xl">{s.icono}</span>
                    <div>
                      <h3 className="font-heading font-bold text-white text-xl">{s.nombre}</h3>
                      <p className="text-white/80 text-sm font-body mt-0.5">{s.descripcion}</p>
                    </div>
                  </div>
                </div>

                {/* Incluye */}
                <div className="p-5 flex-1">
                  <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-3">Incluye</p>
                  <ul className="space-y-1.5 mb-5">
                    {s.incluye.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-gray-700 font-body">
                        <CheckCircle2 className="w-4 h-4 text-brand-green shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>

                  {/* Tarifas */}
                  <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-3">Tarifas desde</p>
                  <div className="space-y-2">
                    {s.tarifas.map((t) => (
                      <div key={t.nombre} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-white/80 shadow-sm">
                        <span className="text-sm font-body text-gray-700">{t.nombre}</span>
                        <span className="text-sm font-heading font-bold text-brand-green">{fmt(t.precio)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="px-5 pb-5">
                  <Link
                    href={`/servicios-hogar/solicitar?servicio=${encodeURIComponent(s.nombre)}`}
                    className={`w-full flex items-center justify-center gap-2 bg-gradient-to-r ${s.color} text-white font-body font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity shadow-md`}
                  >
                    Solicitar {s.nombre} <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Galería de fotos */}
      <GaleriaServicios />

      {/* Reseñas de clientes */}
      <ResenasClientes />

      {/* Garantías */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="container-max">
          <div className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              ¿Por qué elegirnos?
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {GARANTIAS.map((g) => (
              <div key={g.titulo} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm text-center">
                <div className="w-12 h-12 bg-brand-green/10 rounded-xl flex items-center justify-center text-brand-green mx-auto mb-4">
                  {g.icono}
                </div>
                <h3 className="font-heading font-bold text-gray-900 mb-2">{g.titulo}</h3>
                <p className="text-gray-500 font-body text-sm leading-relaxed">{g.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Portal de clientes */}
      <section className="py-20 px-4">
        <div className="container-max">
          <div className="grid lg:grid-cols-2 gap-10 items-center bg-gradient-to-br from-brand-green to-brand-green-mid rounded-3xl p-8 sm:p-12 text-white overflow-hidden relative">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <div className="relative">
              <span className="inline-block bg-white/15 text-white text-sm font-body font-semibold px-4 py-1.5 rounded-full mb-5">
                👤 Portal de clientes
              </span>
              <h2 className="font-heading font-bold text-3xl sm:text-4xl mb-4 leading-tight">
                Crea tu cuenta y controla todo desde un solo lugar
              </h2>
              <p className="text-white/80 font-body text-lg mb-8">
                Agenda servicios, haz seguimiento en tiempo real, consulta la disponibilidad y guarda tus direcciones favoritas. Ingresa con Google, Apple, tu correo o WhatsApp.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/portal/ingresar" className="inline-flex items-center justify-center gap-2 bg-white text-brand-green font-body font-bold px-7 py-3.5 rounded-xl shadow-lg hover:bg-green-50 transition-colors">
                  <UserRound className="w-5 h-5" /> Crear cuenta gratis
                </Link>
                <Link href="/portal" className="inline-flex items-center justify-center gap-2 border-2 border-white/40 hover:border-white text-white font-body font-semibold px-7 py-3.5 rounded-xl transition-colors">
                  Ya tengo cuenta
                </Link>
              </div>
            </div>
            <div className="relative grid grid-cols-2 gap-4">
              {[
                { icono: <CalendarCheck className="w-6 h-6" />, titulo: 'Agenda en línea', desc: 'Reserva el horario que prefieras' },
                { icono: <Bell className="w-6 h-6" />, titulo: 'Seguimiento', desc: 'Sigue el estado de cada servicio' },
                { icono: <Clock className="w-6 h-6" />, titulo: 'Disponibilidad', desc: 'Consulta cupos libres en tiempo real' },
                { icono: <MapPin className="w-6 h-6" />, titulo: 'Tus direcciones', desc: 'Guárdalas para agendar más rápido' },
              ].map((f) => (
                <div key={f.titulo} className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-5">
                  <div className="w-11 h-11 bg-white/15 rounded-xl flex items-center justify-center mb-3">{f.icono}</div>
                  <p className="font-heading font-bold mb-1">{f.titulo}</p>
                  <p className="text-white/70 text-sm font-body leading-snug">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-20 px-4 gradient-brand text-white">
        <div className="container-max text-center">
          <h2 className="font-heading font-bold text-3xl sm:text-4xl mb-6">
            ¿Listo para tener tu hogar impecable?
          </h2>
          <p className="text-white/80 font-body text-lg max-w-xl mx-auto mb-10">
            Agenda ahora y recibe confirmación en menos de 30 minutos.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/servicios-hogar/solicitar"
              className="inline-flex items-center justify-center gap-2 bg-white text-brand-green font-body font-bold px-8 py-4 rounded-xl shadow-lg hover:bg-green-50 transition-colors"
            >
              Solicitar servicio <ChevronRight className="w-5 h-5" />
            </Link>
            <a
              href="tel:+573208081399"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/40 hover:border-white text-white font-body font-semibold px-8 py-4 rounded-xl transition-colors"
            >
              <Phone className="w-5 h-5" /> +57 320 808 1399
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
