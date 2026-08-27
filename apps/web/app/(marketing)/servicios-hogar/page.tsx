import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Star, Phone, Clock, Shield, Award, ChevronRight, Users, UserRound, CalendarCheck, Bell, MapPin } from 'lucide-react'
import { GaleriaServicios } from '@/components/servicios-hogar/GaleriaServicios'
import { ResenasClientes } from '@/components/servicios-hogar/ResenasClientes'
import { Reveal, RevealGrupo, RevealItem } from '@/components/ui/Reveal'
import { FotoFondo, Velo } from '@/components/ui/FotoFondo'

export const metadata: Metadata = {
  title: 'Servicios del Hogar',
  description: 'Contrata servicios de aseo, limpieza profunda, atención en eventos y más. Personal capacitado y de confianza directamente en tu hogar.',
}

const SERVICIOS = [
  {
    icono: '🧹',
    nombre: 'Aseo Regular',
    foto: '/images/servicios-hogar/aseo-regular.jpg',
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
    foto: '/images/servicios-hogar/limpieza-profunda.jpg',
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
    foto: '/images/servicios-hogar/post-obra.jpg',
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
    foto: '/images/servicios-hogar/eventos.jpg',
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
    foto: '/images/servicios-hogar/cocina.jpg',
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
    foto: '/images/servicios-hogar/jardin.jpg',
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
    <div>
      {/*
        El hero arranca en el borde superior de la ventana (sin `pt` en el
        contenedor): el header transparente se superpone sobre él. Antes había
        un `pt-20` que dejaba una franja BLANCA arriba y el logo y el menú
        blancos del header quedaban invisibles hasta hacer scroll.
      */}
      <section className="relative isolate overflow-hidden px-4 pb-24 pt-32 text-white sm:pt-36">
        <FotoFondo src="/images/servicios-hogar/hero.jpg" posicion="center 35%" />
        <Velo />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '60px 60px' }}
          aria-hidden="true"
        />

        <div className="container-max relative text-center">
          <Reveal direccion="escala">
            <span className="mb-6 inline-block rounded-full border border-white/20 bg-white/10 px-4 py-1.5 font-body text-sm font-semibold text-white backdrop-blur-sm">
              🏠 Servicios del Hogar
            </span>
          </Reveal>

          <Reveal retraso={0.05}>
            <h1 className="mb-6 font-heading text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[4.25rem]">
              Tu hogar impecable,<br />
              <span className="text-green-300">sin preocupaciones</span>
            </h1>
          </Reveal>

          <Reveal retraso={0.12}>
            <p className="mx-auto mb-10 max-w-2xl font-body text-lg text-white/85 sm:text-xl">
              Contrata servicios de aseo, limpieza profunda, atención en eventos y más.
              Personal capacitado, verificado y de confianza de <strong className="font-semibold text-white">Conserjes Inmobiliarios</strong>.
            </p>
          </Reveal>

          <Reveal retraso={0.2}>
            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                href="/servicios-hogar/tienda"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 font-body text-base font-bold text-brand-green shadow-lg transition-all hover:-translate-y-0.5 hover:bg-green-50 hover:shadow-xl"
              >
                🛒 Explorar la tienda <ChevronRight className="h-5 w-5" />
              </Link>
              <Link
                href="/servicios-hogar/solicitar"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-8 py-4 font-body text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-white/20"
              >
                Solicitar servicio
              </Link>
            </div>
          </Reveal>

          <Reveal retraso={0.3}>
            <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3 font-body text-sm text-white/80">
              <div className="flex items-center gap-2"><Users className="h-4 w-4" /> +1.069 concerjes</div>
              <div className="flex items-center gap-2"><Shield className="h-4 w-4" /> Personal verificado</div>
              <div className="flex items-center gap-2"><Star className="h-4 w-4" /> 36 años de experiencia</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="container-max">
          <Reveal className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              ¿Cómo funciona?
            </h2>
            <p className="text-gray-500 font-body text-lg max-w-xl mx-auto">
              Agenda tu servicio en 3 simples pasos
            </p>
          </Reveal>
          <RevealGrupo className="grid gap-8 md:grid-cols-3" escalon={0.12}>
            {PASOS.map((p) => (
              <RevealItem key={p.num} className="text-center">
                <div className="w-16 h-16 bg-brand-green rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-green-200">
                  <span className="text-white font-heading font-bold text-2xl">{p.num}</span>
                </div>
                <h3 className="font-heading font-bold text-xl text-gray-900 mb-3">{p.titulo}</h3>
                <p className="text-gray-500 font-body leading-relaxed">{p.desc}</p>
              </RevealItem>
            ))}
          </RevealGrupo>
        </div>
      </section>

      {/* Catálogo de servicios */}
      <section id="servicios" className="py-20 px-4">
        <div className="container-max">
          <Reveal className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Nuestros servicios
            </h2>
            <p className="text-gray-500 font-body text-lg max-w-xl mx-auto">
              Escoge el servicio que necesitas y el horario que más te convenga
            </p>
          </Reveal>

          <RevealGrupo className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {SERVICIOS.map((s) => (
              <RevealItem key={s.nombre} className={`group flex flex-col overflow-hidden rounded-2xl border ${s.border} ${s.bg} shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}>
                {/* Foto del servicio (si falta el archivo queda el degradado) */}
                <div className="relative aspect-[16/9] overflow-hidden">
                  <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">
                    <FotoFondo
                      src={s.foto}
                      degradado={null}
                      className={`bg-gradient-to-br ${s.color}`}
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-5">
                    <span className="text-4xl drop-shadow-lg">{s.icono}</span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-xl font-bold text-white drop-shadow">{s.nombre}</h3>
                      <p className="mt-0.5 font-body text-sm text-white/85 drop-shadow">{s.descripcion}</p>
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
                    className={`flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r ${s.color} py-3 font-body font-semibold text-white shadow-md transition-opacity hover:opacity-90`}
                  >
                    Solicitar {s.nombre} <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </RevealItem>
            ))}
          </RevealGrupo>
        </div>
      </section>

      {/* Galería de fotos */}
      <GaleriaServicios />

      {/* Reseñas de clientes */}
      <ResenasClientes />

      {/* Garantías */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="container-max">
          <Reveal className="text-center mb-14">
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              ¿Por qué elegirnos?
            </h2>
          </Reveal>
          <RevealGrupo className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {GARANTIAS.map((g) => (
              <RevealItem key={g.titulo} className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm transition-shadow hover:shadow-md">
                <div className="w-12 h-12 bg-brand-green/10 rounded-xl flex items-center justify-center text-brand-green mx-auto mb-4">
                  {g.icono}
                </div>
                <h3 className="font-heading font-bold text-gray-900 mb-2">{g.titulo}</h3>
                <p className="text-gray-500 font-body text-sm leading-relaxed">{g.desc}</p>
              </RevealItem>
            ))}
          </RevealGrupo>
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
