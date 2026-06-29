import Link from 'next/link'
import {
  Building2, ShieldCheck, Users, Wrench, Leaf,
  Phone, Mail, MapPin, ArrowRight, CheckCircle2,
  Star, Clock, Award, ChevronRight,
} from 'lucide-react'

const servicios = [
  {
    icon: Building2,
    titulo: 'Administración de Edificios',
    desc: 'Gestión integral de conjuntos residenciales y corporativos: mantenimiento, portería y coordinación de personal.',
    color: 'bg-green-50 text-green-700 border-green-100',
  },
  {
    icon: Users,
    titulo: 'Personal de Conserjes',
    desc: 'Suministro de personal calificado, uniformado y capacitado para la atención de copropiedades y empresas.',
    color: 'bg-blue-50 text-blue-700 border-blue-100',
  },
  {
    icon: Wrench,
    titulo: 'Mantenimiento Preventivo',
    desc: 'Programas de mantenimiento de instalaciones eléctricas, hidráulicas, zonas comunes y equipos.',
    color: 'bg-orange-50 text-orange-700 border-orange-100',
  },
  {
    icon: Leaf,
    titulo: 'Jardinería y Aseo',
    desc: 'Servicios de aseo profundo, jardinería y mantenimiento de zonas verdes con insumos de calidad.',
    color: 'bg-teal-50 text-teal-700 border-teal-100',
  },
  {
    icon: ShieldCheck,
    titulo: 'Seguridad y Control',
    desc: 'Protocolos de seguridad, control de acceso y vigilancia para la tranquilidad de los residentes.',
    color: 'bg-purple-50 text-purple-700 border-purple-100',
  },
  {
    icon: Award,
    titulo: 'Gestión de Contratos',
    desc: 'Administración transparente de contratos con informes periódicos y rendición de cuentas.',
    color: 'bg-rose-50 text-rose-700 border-rose-100',
  },
]

const stats = [
  { value: '+200', label: 'Copropiedades atendidas' },
  { value: '+15', label: 'Años de experiencia' },
  { value: '+500', label: 'Empleados activos' },
  { value: '5', label: 'Sedes en Colombia' },
]

const valores = [
  'Compromiso con la calidad',
  'Personal certificado',
  'Respuesta oportuna 24/7',
  'Transparencia en la gestión',
  'Cobertura nacional',
  'Tecnología de vanguardia',
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-brand-green rounded-xl flex items-center justify-center shrink-0 shadow-sm">
              <span className="text-white font-heading font-bold text-base">CI</span>
            </div>
            <div className="min-w-0">
              <p className="font-heading font-bold text-sm text-gray-900 leading-tight truncate">
                Conserjes Inmobiliarios
              </p>
              <p className="font-body text-xs text-brand-green leading-tight hidden sm:block">
                NIT 800093388-2
              </p>
            </div>
          </div>

          {/* Links desktop */}
          <div className="hidden md:flex items-center gap-6">
            {[
              { label: 'Nosotros', href: '#nosotros' },
              { label: 'Servicios', href: '#servicios' },
              { label: 'Contacto', href: '#contacto' },
            ].map(l => (
              <a
                key={l.label}
                href={l.href}
                className="font-body text-sm text-gray-600 hover:text-brand-green transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <Link
            href="/login"
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-brand-green-dark transition-colors shadow-sm shrink-0"
          >
            <span className="hidden xs:inline">Plataforma</span>
            <span className="xs:hidden">Ingresar</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1B5E20] via-[#2E7D32] to-[#388E3C]">
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1.5px, transparent 0)', backgroundSize: '40px 40px' }}
        />
        {/* Blobs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-[400px] h-[400px] rounded-full bg-black/10 blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-36">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Text */}
            <div className="text-white">
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-6">
                <span className="w-2 h-2 rounded-full bg-green-300 animate-pulse shrink-0" />
                <span className="font-body text-xs text-green-100 font-medium">
                  Más de 15 años cuidando su propiedad
                </span>
              </div>

              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl leading-tight mb-6">
                Expertos en
                <br />
                <span className="text-green-300">administración</span>
                <br />
                de copropiedades
              </h1>

              <p className="font-body text-lg text-green-100 leading-relaxed mb-8 max-w-lg">
                Brindamos soluciones integrales de conciergería, mantenimiento y gestión
                para conjuntos residenciales y corporativos en toda Colombia.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <a
                  href="#contacto"
                  className="inline-flex items-center justify-center gap-2 bg-white text-brand-green font-body font-bold text-base px-7 py-3.5 rounded-2xl hover:bg-green-50 transition-all shadow-xl hover:-translate-y-0.5 duration-200"
                >
                  Solicitar información
                </a>
                <a
                  href="#servicios"
                  className="inline-flex items-center justify-center gap-2 border border-white/30 text-white font-body font-semibold text-base px-7 py-3.5 rounded-2xl hover:bg-white/10 transition-all"
                >
                  Ver servicios
                  <ChevronRight className="w-4 h-4" />
                </a>
              </div>

              {/* Check list */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {valores.map(v => (
                  <div key={v} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-300 shrink-0" />
                    <span className="font-body text-sm text-green-100">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Card visual */}
            <div className="hidden lg:flex flex-col gap-4">
              {/* Main card */}
              <div className="bg-white/10 border border-white/20 backdrop-blur rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-heading font-bold text-white text-sm">Gestión en Tiempo Real</p>
                    <p className="font-body text-xs text-green-300">Plataforma de inventarios</p>
                  </div>
                </div>
                {[
                  { label: 'Productos en stock', value: '1,240', pct: 82 },
                  { label: 'Órdenes activas',    value: '34',    pct: 45 },
                  { label: 'Sedes operativas',   value: '5',     pct: 100 },
                ].map(r => (
                  <div key={r.label} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-body text-xs text-green-200">{r.label}</span>
                      <span className="font-heading font-bold text-sm text-white">{r.value}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full">
                      <div
                        className="h-full bg-green-300 rounded-full"
                        style={{ width: `${r.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Mini cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/10 border border-white/20 rounded-2xl p-4 text-center">
                  <p className="font-heading font-bold text-2xl text-white">+200</p>
                  <p className="font-body text-xs text-green-300 mt-1">Copropiedades</p>
                </div>
                <div className="bg-white/10 border border-white/20 rounded-2xl p-4 text-center">
                  <p className="font-heading font-bold text-2xl text-white">+500</p>
                  <p className="font-body text-xs text-green-300 mt-1">Empleados</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
            {stats.map(s => (
              <div key={s.label} className="text-center">
                <p className="font-heading font-bold text-3xl sm:text-4xl text-green-400">{s.value}</p>
                <p className="font-body text-sm text-gray-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NOSOTROS ── */}
      <section id="nosotros" className="py-16 sm:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Image placeholder */}
            <div className="flex-1 w-full">
              <div className="bg-gradient-to-br from-[#E8F5E9] to-[#C8E6C9] rounded-3xl aspect-[4/3] flex items-center justify-center relative overflow-hidden">
                <div
                  className="absolute inset-0 opacity-[0.08]"
                  style={{ backgroundImage: 'radial-gradient(circle, #2E7D32 1px, transparent 0)', backgroundSize: '28px 28px' }}
                />
                <div className="relative text-center px-8">
                  <div className="w-20 h-20 bg-brand-green rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl">
                    <span className="text-white font-heading font-bold text-3xl">CI</span>
                  </div>
                  <p className="font-heading font-bold text-2xl text-brand-green">
                    Conserjes Inmobiliarios Ltda
                  </p>
                  <p className="font-body text-sm text-green-700 mt-2">
                    Fundada en 2009 · Bogotá, Colombia
                  </p>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="flex-1">
              <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">
                Quiénes somos
              </p>
              <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-5">
                Más de 15 años de excelencia en la gestión de copropiedades
              </h2>
              <p className="font-body text-gray-500 text-base leading-relaxed mb-5">
                Somos una empresa colombiana especializada en la administración y operación de conjuntos
                residenciales, edificios corporativos y centros comerciales. Nuestro equipo de profesionales
                garantiza la correcta prestación de servicios de conciergería, aseo, mantenimiento y
                seguridad.
              </p>
              <p className="font-body text-gray-500 text-base leading-relaxed mb-8">
                Contamos con cobertura en las principales ciudades del país, con sedes operativas que nos
                permiten responder con rapidez y eficiencia a las necesidades de nuestros clientes.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="#servicios"
                  className="inline-flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-6 py-3 rounded-xl hover:bg-brand-green-dark transition-colors shadow-sm"
                >
                  Nuestros servicios
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="#contacto"
                  className="inline-flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Contáctenos
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICIOS ── */}
      <section id="servicios" className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">
              Lo que hacemos
            </p>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Servicios integrales para su propiedad
            </h2>
            <p className="font-body text-gray-500 text-base leading-relaxed">
              Ofrecemos una gama completa de servicios diseñados para garantizar el correcto
              funcionamiento y valorización de su copropiedad.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {servicios.map(s => (
              <div
                key={s.titulo}
                className={`bg-white rounded-2xl p-6 border hover:shadow-md transition-all duration-200 ${s.color}`}
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${s.color}`}>
                  <s.icon className="w-6 h-6" />
                </div>
                <h3 className="font-heading font-bold text-base text-gray-900 mb-2">{s.titulo}</h3>
                <p className="font-body text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLATAFORMA (banner) ── */}
      <section className="py-14 bg-white border-t border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-6 shadow-xl">
            <div className="flex-1 text-center sm:text-left">
              <p className="font-body text-sm text-green-300 font-semibold uppercase tracking-widest mb-2">
                Solo para personal autorizado
              </p>
              <h3 className="font-heading font-bold text-2xl sm:text-3xl text-white mb-3">
                Plataforma de Inventarios
              </h3>
              <p className="font-body text-green-100 text-base leading-relaxed max-w-lg">
                Sistema interno de gestión de stock, aprovisionamiento y control de activos
                con inteligencia artificial para el equipo de Conserjes Inmobiliarios Ltda.
              </p>
            </div>
            <div className="shrink-0">
              <Link
                href="/login"
                className="inline-flex items-center gap-3 bg-white text-brand-green font-body font-bold text-base px-8 py-4 rounded-2xl hover:bg-green-50 transition-all shadow-lg hover:-translate-y-0.5 duration-200 whitespace-nowrap"
              >
                Ingresar a la plataforma
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTACTO ── */}
      <section id="contacto" className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">
              Contáctenos
            </p>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Estamos listos para atenderle
            </h2>
            <p className="font-body text-gray-500 text-base">
              Comuníquese con nosotros para solicitar una propuesta personalizada.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-3xl mx-auto">
            {[
              { icon: Phone, titulo: 'Teléfono', valor: '+57 (1) 800-CONSERJE', sub: 'Lun–Vie 7am–7pm' },
              { icon: Mail,  titulo: 'Correo',   valor: 'info@conserjesinmobiliarios.com', sub: 'Respuesta en 24h' },
              { icon: MapPin,titulo: 'Sede Principal', valor: 'Bogotá, Colombia', sub: 'Cobertura nacional' },
            ].map(c => (
              <div key={c.titulo} className="bg-white border border-gray-100 rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-brand-green/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <c.icon className="w-6 h-6 text-brand-green" />
                </div>
                <p className="font-heading font-bold text-sm text-gray-900 mb-1">{c.titulo}</p>
                <p className="font-body text-sm text-gray-700 font-medium mb-1">{c.valor}</p>
                <p className="font-body text-xs text-gray-400">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Rating badges */}
          <div className="flex flex-wrap justify-center gap-4 mt-10">
            {[
              { icon: Star,  text: '4.9 / 5 valoración promedio' },
              { icon: Clock, text: 'Respuesta en menos de 2 horas' },
              { icon: Award, text: 'ISO 9001 en proceso de certificación' },
            ].map(b => (
              <div key={b.text} className="flex items-center gap-2 bg-white border border-gray-100 rounded-full px-4 py-2 shadow-sm">
                <b.icon className="w-4 h-4 text-brand-green shrink-0" />
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
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
                  <span className="text-white font-heading font-bold text-sm">CI</span>
                </div>
                <p className="font-heading font-bold text-white text-sm">Conserjes Inmobiliarios</p>
              </div>
              <p className="font-body text-sm text-gray-500 leading-relaxed">
                Expertos en administración y operación de copropiedades desde 2009.
              </p>
            </div>

            {/* Links */}
            <div>
              <p className="font-heading font-bold text-white text-sm mb-4">Empresa</p>
              <ul className="space-y-2">
                {['Nosotros', 'Servicios', 'Clientes', 'Trabaja con nosotros'].map(l => (
                  <li key={l}>
                    <a href="#" className="font-body text-sm text-gray-500 hover:text-gray-300 transition-colors">{l}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="font-heading font-bold text-white text-sm mb-4">Contacto</p>
              <div className="space-y-2">
                <p className="font-body text-sm text-gray-500">Bogotá, Colombia</p>
                <p className="font-body text-sm text-gray-500">info@conserjesinmobiliarios.com</p>
                <p className="font-body text-sm text-gray-500">NIT: 800093388-2</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="font-body text-xs text-gray-600">
              © {new Date().getFullYear()} Conserjes Inmobiliarios Ltda. Todos los derechos reservados.
            </p>
            <Link
              href="/login"
              className="font-body text-xs text-brand-green hover:text-green-400 transition-colors flex items-center gap-1.5"
            >
              Acceso a plataforma interna
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
