import Link from 'next/link'
import {
  Building2, ShieldCheck, Users, Wrench, Leaf,
  Phone, Mail, MapPin, ArrowRight, CheckCircle2,
  Coffee, Sparkles, ChevronRight, Facebook,
  HeartPulse, HardHat, ClipboardCheck, BookOpen,
} from 'lucide-react'

const servicios = [
  {
    icon: Sparkles,
    titulo: 'Aseo Integral',
    desc: 'Servicio de limpieza y desinfección que abarca todas las labores necesarias para la conservación, protección y mantenimiento de las instalaciones de su empresa.',
    color: 'bg-blue-50 text-blue-700 border-blue-100',
  },
  {
    icon: Building2,
    titulo: 'Mantenimiento Locativo',
    desc: 'Gestión integral del mantenimiento de instalaciones eléctricas, hidráulicas, zonas comunes y equipos para garantizar el correcto funcionamiento de su propiedad.',
    color: 'bg-green-50 text-green-700 border-green-100',
  },
  {
    icon: Coffee,
    titulo: 'Cafetería Empresarial',
    desc: 'Servicio de cafetería para empresas con altos procesos y protocolos de higiene, calidad y eficiencia. Alimentación de calidad para su equipo de trabajo.',
    color: 'bg-orange-50 text-orange-700 border-orange-100',
  },
  {
    icon: Leaf,
    titulo: 'Jardinería y Zonas Verdes',
    desc: 'Cuidado y mantenimiento de jardines, zonas verdes y áreas exteriores con personal capacitado e insumos biodegradables respetuosos con el medio ambiente.',
    color: 'bg-teal-50 text-teal-700 border-teal-100',
  },
  {
    icon: Users,
    titulo: 'Conciergería Especializada',
    desc: 'Servicio especializado de conciergería para labores auxiliares, atención y control de acceso de personas en conjuntos residenciales y corporativos.',
    color: 'bg-purple-50 text-purple-700 border-purple-100',
  },
  {
    icon: Wrench,
    titulo: 'Limpieza Especial en Alturas',
    desc: 'Servicios de limpieza especial para fachadas, áreas de difícil acceso y espacios en altura que requieren equipos y personal con certificación específica.',
    color: 'bg-rose-50 text-rose-700 border-rose-100',
  },
]

const sstPilares = [
  {
    icon: HeartPulse,
    titulo: 'Bienestar del trabajador',
    desc: 'Promovemos la salud física y mental de nuestros colaboradores con programas de bienestar, pausas activas y vigilancia epidemiológica.',
  },
  {
    icon: HardHat,
    titulo: 'Prevención de accidentes',
    desc: 'Implementamos protocolos de seguridad, uso de EPP y capacitación continua para eliminar o minimizar los riesgos laborales en cada actividad.',
  },
  {
    icon: ClipboardCheck,
    titulo: 'Cumplimiento normativo',
    desc: 'Cumplimos con el Decreto 1072 de 2015 y la Resolución 0312 de 2019, manteniendo nuestro SG-SST actualizado y auditado periódicamente.',
  },
  {
    icon: BookOpen,
    titulo: 'Capacitación continua',
    desc: 'Nuestro personal recibe formación constante en manejo seguro de químicos, trabajo en alturas, primeros auxilios y conductas de emergencia.',
  },
]

const hitos = [
  { año: '1990', evento: 'Fundación de Conserjes Inmobiliarios Ltda en Bogotá ante la Cámara de Comercio.' },
  { año: '2000', evento: 'Expansión a servicios de cafetería empresarial y mantenimiento locativo.' },
  { año: '2008', evento: 'Implementación del Sistema de Gestión de Seguridad y Salud en el Trabajo.' },
  { año: '2012', evento: 'Apertura de operaciones en nuevas ciudades, consolidando cobertura nacional.' },
  { año: '2018', evento: 'Incorporación de insumos biodegradables y políticas de Responsabilidad Social Empresarial.' },
  { año: '2024', evento: 'Más de 1.000 colaboradores activos y contratos con entidades del Estado.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-brand-green rounded-xl flex items-center justify-center shrink-0 shadow-sm">
              <span className="text-white font-heading font-bold text-base">CI</span>
            </div>
            <div className="min-w-0">
              <p className="font-heading font-bold text-sm text-gray-900 leading-tight">Conserjes Inmobiliarios</p>
              <p className="font-body text-xs text-brand-green leading-tight hidden sm:block">NIT 800093388-2</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6">
            {[
              { label: 'Nosotros',  href: '#nosotros'  },
              { label: 'Historia',  href: '#historia'  },
              { label: 'Servicios', href: '#servicios' },
              { label: 'SST',       href: '#sst'       },
              { label: 'Contacto',  href: '#contacto'  },
            ].map(l => (
              <a key={l.label} href={l.href}
                className="font-body text-sm text-gray-600 hover:text-brand-green transition-colors">
                {l.label}
              </a>
            ))}
          </div>

          <Link href="/login"
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-brand-green-dark transition-colors shadow-sm shrink-0">
            <span className="hidden sm:inline">Plataforma interna</span>
            <span className="sm:hidden">Ingresar</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1B5E20] via-[#2E7D32] to-[#388E3C]">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1.5px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-[400px] h-[400px] rounded-full bg-black/10 blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-36">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="text-white">
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-6">
                <span className="w-2 h-2 rounded-full bg-green-300 animate-pulse shrink-0" />
                <span className="font-body text-xs text-green-100 font-medium">Más de 34 años brindando soluciones integrales</span>
              </div>

              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl leading-tight mb-6">
                Servicios de<br />
                <span className="text-green-300">Aseo y Limpieza</span><br />
                en Colombia
              </h1>

              <p className="font-body text-lg text-green-100 leading-relaxed mb-8 max-w-lg">
                Brindamos soluciones para necesidades integrales de aseo, mantenimiento
                locativo, saneamiento y cafetería — creando valor a través de una gestión
                eficiente del talento humano con productos amigables con el medio ambiente.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <a href="#contacto"
                  className="inline-flex items-center justify-center gap-2 bg-white text-brand-green font-body font-bold text-base px-7 py-3.5 rounded-2xl hover:bg-green-50 transition-all shadow-xl hover:-translate-y-0.5 duration-200">
                  Contáctenos ahora
                </a>
                <a href="#servicios"
                  className="inline-flex items-center justify-center gap-2 border border-white/30 text-white font-body font-semibold text-base px-7 py-3.5 rounded-2xl hover:bg-white/10 transition-all">
                  Ver servicios <ChevronRight className="w-4 h-4" />
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  'Fundados en 1990 · +34 años',
                  'Más de 1.000 colaboradores',
                  'Insumos biodegradables',
                  'SG-SST implementado',
                  'Contratos con entidades del Estado',
                  'Cobertura en toda Colombia',
                ].map(v => (
                  <div key={v} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-300 shrink-0" />
                    <span className="font-body text-sm text-green-100">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Misión / Visión card */}
            <div className="hidden lg:flex flex-col gap-4">
              <div className="bg-white/10 border border-white/20 backdrop-blur rounded-3xl p-6">
                <p className="font-heading font-bold text-white text-base mb-2">🎯 Misión</p>
                <p className="font-body text-sm text-green-100 leading-relaxed mb-5">
                  Brindar soluciones para necesidades integrales de aseo, mantenimiento locativo,
                  saneamiento y cafetería; creando valor mediante la gestión eficiente del talento
                  humano y el uso de productos amigables con el medio ambiente.
                </p>
                <div className="h-px bg-white/10 mb-5" />
                <p className="font-heading font-bold text-white text-base mb-2">🏆 Visión</p>
                <p className="font-body text-sm text-green-100 leading-relaxed">
                  Ser reconocidos como una de las empresas líderes en Colombia en la prestación
                  de servicios de aseo, cafetería y mantenimiento, ofreciendo productos de óptima
                  calidad con atención de alto nivel.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/10 border border-white/20 rounded-2xl p-4 text-center">
                  <p className="font-heading font-bold text-2xl text-white">1990</p>
                  <p className="font-body text-xs text-green-300 mt-1">Fundación</p>
                </div>
                <div className="bg-white/10 border border-white/20 rounded-2xl p-4 text-center">
                  <p className="font-heading font-bold text-2xl text-white">+1K</p>
                  <p className="font-body text-xs text-green-300 mt-1">Colaboradores</p>
                </div>
                <div className="bg-white/10 border border-white/20 rounded-2xl p-4 text-center">
                  <p className="font-heading font-bold text-2xl text-white">🌿</p>
                  <p className="font-body text-xs text-green-300 mt-1">Eco-friendly</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── NOSOTROS ── */}
      <section id="nosotros" className="py-16 sm:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            <div className="flex-1 w-full max-w-lg mx-auto lg:mx-0">
              <div className="bg-gradient-to-br from-[#E8F5E9] to-[#C8E6C9] rounded-3xl aspect-[4/3] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.08]"
                  style={{ backgroundImage: 'radial-gradient(circle, #2E7D32 1px, transparent 0)', backgroundSize: '28px 28px' }} />
                <div className="relative text-center px-8">
                  <div className="w-20 h-20 bg-brand-green rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl">
                    <span className="text-white font-heading font-bold text-3xl">CI</span>
                  </div>
                  <p className="font-heading font-bold text-xl text-brand-green">Conserjes Inmobiliarios Ltda</p>
                  <p className="font-body text-sm text-green-700 mt-2">Fundada el 6 de abril de 1990 · Bogotá, Colombia</p>
                </div>
              </div>
            </div>

            <div className="flex-1">
              <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">Quiénes somos</p>
              <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-5">
                Más de 34 años dedicados a la excelencia en el aseo y mantenimiento
              </h2>
              <p className="font-body text-gray-500 text-base leading-relaxed mb-4">
                Conserjes Inmobiliarios Ltda fue fundada el 6 de abril de 1990 en Bogotá D.C.,
                dedicándose desde sus inicios a la limpieza general interior de edificios y a la
                prestación de servicios auxiliares de aseo. Durante más de tres décadas hemos
                construido relaciones sólidas con nuestros clientes, creciendo junto a ellos.
              </p>
              <p className="font-body text-gray-500 text-base leading-relaxed mb-8">
                Contamos con procesos planeados y estructurados para optimizar las operaciones y
                reducir costos sin afectar la calidad del servicio. Desarrollamos servicios sostenibles
                utilizando productos biodegradables y buenas prácticas empresariales, y hoy somos
                una empresa mediana con más de 1.000 colaboradores activos en todo el país.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
                  <p className="font-heading font-bold text-sm text-brand-green mb-2">🎯 Misión</p>
                  <p className="font-body text-sm text-gray-600 leading-relaxed">
                    Brindar soluciones para necesidades integrales de aseo, mantenimiento y cafetería,
                    creando valor mediante la gestión eficiente del talento humano.
                  </p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                  <p className="font-heading font-bold text-sm text-blue-700 mb-2">🏆 Visión</p>
                  <p className="font-body text-sm text-gray-600 leading-relaxed">
                    Ser reconocidos como empresa líder en Colombia en servicios de aseo, cafetería
                    y mantenimiento con atención de alto nivel.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <a href="#servicios"
                  className="inline-flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-6 py-3 rounded-xl hover:bg-brand-green-dark transition-colors shadow-sm">
                  Nuestros servicios <ArrowRight className="w-4 h-4" />
                </a>
                <a href="#contacto"
                  className="inline-flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors">
                  Contáctenos
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── HISTORIA ── */}
      <section id="historia" className="py-16 sm:py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">Nuestra trayectoria</p>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">Historia y crecimiento</h2>
            <p className="font-body text-gray-500 text-base">
              Tres décadas de trabajo, compromiso y crecimiento al servicio de Colombia.
            </p>
          </div>

          <div className="relative">
            {/* Línea vertical */}
            <div className="absolute left-4 sm:left-1/2 top-0 bottom-0 w-0.5 bg-green-100 -translate-x-1/2 hidden sm:block" />

            <div className="space-y-6 sm:space-y-0">
              {hitos.map((h, i) => (
                <div key={h.año} className={`relative flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-0 ${i % 2 === 0 ? 'sm:flex-row' : 'sm:flex-row-reverse'} mb-8`}>
                  {/* Card */}
                  <div className={`flex-1 ${i % 2 === 0 ? 'sm:pr-12 sm:text-right' : 'sm:pl-12'}`}>
                    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow inline-block w-full sm:max-w-sm">
                      <p className="font-heading font-bold text-brand-green text-sm mb-1">{h.año}</p>
                      <p className="font-body text-sm text-gray-600 leading-relaxed">{h.evento}</p>
                    </div>
                  </div>

                  {/* Dot */}
                  <div className="hidden sm:flex absolute left-1/2 -translate-x-1/2 w-5 h-5 bg-brand-green rounded-full border-4 border-white shadow-md z-10" />

                  {/* Spacer */}
                  <div className="flex-1 hidden sm:block" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICIOS ── */}
      <section id="servicios" className="py-16 sm:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">Lo que hacemos</p>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Servicios integrales para su empresa o copropiedad
            </h2>
            <p className="font-body text-gray-500 text-base leading-relaxed">
              Ofrecemos una gama completa de soluciones de aseo, mantenimiento y cafetería
              con los más altos estándares de calidad y eficiencia.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {servicios.map(s => (
              <div key={s.titulo}
                className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-md hover:border-brand-green/20 transition-all duration-200">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${s.color}`}>
                  <s.icon className="w-6 h-6" />
                </div>
                <h3 className="font-heading font-bold text-base text-gray-900 mb-2">{s.titulo}</h3>
                <p className="font-body text-sm text-gray-500 leading-relaxed mb-4">{s.desc}</p>
                <a href="#contacto"
                  className="inline-flex items-center gap-1.5 font-body text-sm font-semibold text-brand-green hover:gap-2.5 transition-all">
                  Contáctenos ahora <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SST ── */}
      <section id="sst" className="py-16 sm:py-24 bg-gray-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 bg-green-900/50 border border-green-700/30 rounded-full px-4 py-1.5 mb-4">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <span className="font-body text-xs text-green-300 font-medium uppercase tracking-widest">SG-SST</span>
            </div>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-white mb-4">
              Seguridad y Salud en el Trabajo
            </h2>
            <p className="font-body text-gray-400 text-base leading-relaxed">
              En Conserjes Inmobiliarios, la seguridad y el bienestar de nuestros colaboradores
              es una prioridad estratégica. Contamos con un Sistema de Gestión de Seguridad
              y Salud en el Trabajo (SG-SST) implementado y en mejora continua, dando
              cumplimiento al Decreto 1072 de 2015 y la Resolución 0312 de 2019.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
            {sstPilares.map(p => (
              <div key={p.titulo} className="bg-gray-800 border border-gray-700 rounded-2xl p-5 hover:border-green-700/50 transition-colors">
                <div className="w-11 h-11 bg-green-900/50 rounded-xl flex items-center justify-center mb-4">
                  <p.icon className="w-5 h-5 text-green-400" />
                </div>
                <h3 className="font-heading font-bold text-sm text-white mb-2">{p.titulo}</h3>
                <p className="font-body text-xs text-gray-400 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>

          {/* Política SST */}
          <div className="bg-gradient-to-r from-green-900/40 to-green-800/20 border border-green-700/30 rounded-3xl p-7 sm:p-10">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="w-12 h-12 bg-green-700/50 rounded-2xl flex items-center justify-center shrink-0">
                <ClipboardCheck className="w-6 h-6 text-green-300" />
              </div>
              <div>
                <p className="font-body text-xs text-green-400 font-semibold uppercase tracking-widest mb-2">
                  Política de Seguridad y Salud en el Trabajo
                </p>
                <p className="font-body text-gray-300 text-base leading-relaxed mb-3">
                  Conserjes Inmobiliarios Ltda se compromete a proteger la seguridad y salud de todos
                  sus trabajadores, contratistas y visitantes, identificando los peligros, evaluando
                  y controlando los riesgos laborales presentes en todas sus actividades.
                </p>
                <p className="font-body text-gray-400 text-sm leading-relaxed">
                  Mediante la mejora continua de nuestros procesos, el cumplimiento de la normatividad
                  vigente colombiana y el fomento de una cultura de autocuidado, garantizamos ambientes
                  de trabajo seguros, saludables y productivos para el crecimiento de nuestra organización
                  y el bienestar de nuestras familias.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── RSE ── */}
      <section className="py-12 bg-gradient-to-r from-[#1B5E20] to-[#2E7D32]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center gap-6 text-white text-center sm:text-left">
            <div className="text-4xl shrink-0">🌿</div>
            <div className="flex-1">
              <p className="font-body text-sm text-green-300 font-semibold uppercase tracking-widest mb-1">
                Responsabilidad Social Empresarial
              </p>
              <h3 className="font-heading font-bold text-xl sm:text-2xl text-white mb-2">
                En Conserjes Inmobiliarios pensamos en RSE
              </h3>
              <p className="font-body text-green-100 text-base leading-relaxed max-w-2xl">
                A través de la mejora continua de nuestros procesos, el respeto por el entorno
                y el bienestar común, buscamos que nuestra organización no solo sea sostenible,
                sino que trascienda en la cultura de las generaciones futuras.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── BANNER PLATAFORMA ── */}
      <section className="py-12 bg-white border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="bg-gray-900 rounded-3xl p-7 sm:p-9 flex flex-col sm:flex-row items-center gap-6 shadow-xl">
            <div className="flex-1 text-center sm:text-left">
              <p className="font-body text-xs text-green-400 font-semibold uppercase tracking-widest mb-2">
                Solo para personal autorizado
              </p>
              <h3 className="font-heading font-bold text-xl sm:text-2xl text-white mb-2">
                Plataforma Interna de Inventarios
              </h3>
              <p className="font-body text-gray-400 text-sm leading-relaxed max-w-lg">
                Sistema interno de gestión de stock, aprovisionamiento y control de activos
                con inteligencia artificial para el equipo operativo.
              </p>
            </div>
            <div className="shrink-0">
              <Link href="/login"
                className="inline-flex items-center gap-2.5 bg-brand-green text-white font-body font-bold text-sm px-7 py-3.5 rounded-xl hover:bg-brand-green-dark transition-all shadow-lg whitespace-nowrap">
                Ingresar a la plataforma
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTACTO ── */}
      <section id="contacto" className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">Contáctenos</p>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Estamos listos para atenderle
            </h2>
            <p className="font-body text-gray-500 text-base">
              Comuníquese con nosotros para solicitar información sobre nuestros servicios.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-3xl mx-auto mb-10">
            {[
              { icon: Phone,  titulo: 'Teléfono',    valor: '(601) 792-6517',                              sub: 'Lunes a viernes' },
              { icon: Mail,   titulo: 'Correo',       valor: 'asistente.gerencia@conserjesinmobiliarios.com', sub: 'Respuesta en 24 horas' },
              { icon: MapPin, titulo: 'Dirección',    valor: 'Carrera 19 # 166-34',                        sub: 'Bogotá D.C., Colombia' },
            ].map(c => (
              <div key={c.titulo} className="bg-white border border-gray-100 rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-brand-green/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <c.icon className="w-6 h-6 text-brand-green" />
                </div>
                <p className="font-heading font-bold text-sm text-gray-900 mb-1">{c.titulo}</p>
                <p className="font-body text-sm text-gray-700 font-medium mb-1 break-all">{c.valor}</p>
                <p className="font-body text-xs text-gray-400">{c.sub}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            {[
              { emoji: '🛡️', text: 'SG-SST implementado · Decreto 1072 de 2015' },
              { emoji: '🌿', text: 'Insumos biodegradables y eco-friendly' },
              { emoji: '⭐', text: 'Fundados en 1990 · Más de 34 años de experiencia' },
              { emoji: '👷', text: 'Más de 1.000 colaboradores activos' },
            ].map(b => (
              <div key={b.text} className="flex items-center gap-2 bg-white border border-gray-100 rounded-full px-4 py-2 shadow-sm">
                <span className="text-base shrink-0">{b.emoji}</span>
                <span className="font-body text-sm text-gray-600">{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-900 text-gray-400">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
                  <span className="text-white font-heading font-bold text-sm">CI</span>
                </div>
                <p className="font-heading font-bold text-white text-sm">Conserjes Inmobiliarios</p>
              </div>
              <p className="font-body text-sm text-gray-500 leading-relaxed mb-3">
                Más de 34 años brindando soluciones integrales de aseo, mantenimiento y cafetería en Colombia.
              </p>
              <a href="https://www.facebook.com/ConserjesInmobiliarios/" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-sm font-body">
                <Facebook className="w-4 h-4" /> Facebook
              </a>
            </div>

            <div>
              <p className="font-heading font-bold text-white text-sm mb-4">Servicios</p>
              <ul className="space-y-2">
                {['Aseo Integral', 'Mantenimiento Locativo', 'Cafetería Empresarial', 'Jardinería', 'Conciergería', 'Limpieza en Alturas'].map(l => (
                  <li key={l}>
                    <a href="#servicios" className="font-body text-sm text-gray-500 hover:text-gray-300 transition-colors">{l}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-heading font-bold text-white text-sm mb-4">Información</p>
              <div className="space-y-2">
                <p className="font-body text-sm text-gray-500">Carrera 19 # 166-34, Bogotá D.C.</p>
                <p className="font-body text-sm text-gray-500">(601) 792-6517</p>
                <p className="font-body text-sm text-gray-500 break-all">asistente.gerencia@conserjesinmobiliarios.com</p>
                <p className="font-body text-sm text-gray-500">NIT: 800093388-2</p>
                <p className="font-body text-sm text-gray-500">Fundada: 6 de abril de 1990</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="font-body text-xs text-gray-600">
              © {new Date().getFullYear()} Conserjes Inmobiliarios Ltda. Todos los derechos reservados.
            </p>
            <Link href="/login"
              className="font-body text-xs text-brand-green hover:text-green-400 transition-colors flex items-center gap-1.5">
              Acceso a plataforma interna <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
