import Link from 'next/link'
import {
  Package, BarChart3, QrCode, Bell, Brain,
  Shield, ArrowRight, CheckCircle2, Truck, Users,
} from 'lucide-react'

const features = [
  {
    icon: Package,
    title: 'Gestión de Inventario',
    desc: 'Control total de productos, stock y categorías A/B/C/D en tiempo real.',
    color: 'bg-green-50 text-green-700',
  },
  {
    icon: QrCode,
    title: 'Escáner de Códigos',
    desc: 'Lee códigos QR y de barras directamente desde el celular sin hardware adicional.',
    color: 'bg-blue-50 text-blue-700',
  },
  {
    icon: Brain,
    title: 'Inteligencia Artificial',
    desc: 'Sugerencias de compra predictivas y reconocimiento visual de productos.',
    color: 'bg-purple-50 text-purple-700',
  },
  {
    icon: Bell,
    title: 'Alertas en Tiempo Real',
    desc: 'Notificaciones automáticas de stock crítico, vencimientos y órdenes pendientes.',
    color: 'bg-orange-50 text-orange-700',
  },
  {
    icon: Truck,
    title: 'Aprovisionamiento',
    desc: 'Control de órdenes de compra y proveedores por grupos de contrato.',
    color: 'bg-teal-50 text-teal-700',
  },
  {
    icon: BarChart3,
    title: 'Reportes y Análisis',
    desc: 'Dashboards con KPIs, rotación de inventario y exportación a Excel.',
    color: 'bg-pink-50 text-pink-700',
  },
]

const stats = [
  { value: '5', label: 'Grupos de contrato' },
  { value: '7', label: 'Roles de usuario' },
  { value: '100%', label: 'En la nube' },
  { value: '24/7', label: 'Disponibilidad' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
              <span className="text-white font-heading font-bold text-sm">CI</span>
            </div>
            <div className="hidden sm:block">
              <p className="font-heading font-bold text-sm text-gray-900 leading-tight">Conserjes Inmobiliarios</p>
              <p className="font-body text-xs text-brand-green leading-tight">Plataforma de Inventarios</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="font-body font-semibold text-sm text-gray-600 hover:text-brand-green transition-colors px-4 py-2 rounded-lg hover:bg-gray-50"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/login"
              className="font-body font-semibold text-sm bg-brand-green text-white px-4 py-2 rounded-xl hover:bg-brand-green-dark transition-colors shadow-sm flex items-center gap-2"
            >
              Acceder
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1B5E20] via-[#2E7D32] to-[#388E3C] text-white">
        {/* dot grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 0)', backgroundSize: '36px 36px' }}
        />
        {/* Blob decorations */}
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] rounded-full bg-black/10 blur-3xl" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-36">
          <div className="max-w-3xl">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-green-300 animate-pulse" />
              <span className="font-body text-xs text-green-100 font-medium">Sistema operativo · 2026</span>
            </div>

            <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl leading-tight mb-6">
              Control inteligente
              <br />
              <span className="text-green-300">de inventarios</span>
            </h1>
            <p className="font-body text-lg sm:text-xl text-green-100 leading-relaxed mb-10 max-w-xl">
              Plataforma integral para la gestión de stock, aprovisionamiento y control de activos de
              <strong className="text-white font-semibold"> Conserjes Inmobiliarios Ltda.</strong>
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2.5 bg-white text-brand-green font-body font-bold text-base px-8 py-4 rounded-2xl hover:bg-green-50 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 duration-200"
              >
                Ingresar al sistema
                <ArrowRight className="w-5 h-5" />
              </Link>
              <a
                href="#caracteristicas"
                className="inline-flex items-center justify-center gap-2 border border-white/30 text-white font-body font-semibold text-base px-8 py-4 rounded-2xl hover:bg-white/10 transition-all"
              >
                Ver características
              </a>
            </div>

            {/* Quick checks */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-8">
              {['Multiplataforma', 'Roles y permisos', 'IA integrada', 'Datos seguros'].map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-green-300 shrink-0" />
                  <span className="font-body text-sm text-green-100">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="bg-gray-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {stats.map(s => (
              <div key={s.label} className="text-center">
                <p className="font-heading font-bold text-3xl text-green-400">{s.value}</p>
                <p className="font-body text-sm text-gray-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="caracteristicas" className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">
              Características
            </p>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
              Todo lo que necesitas en un solo lugar
            </h2>
            <p className="font-body text-gray-500 text-lg">
              Diseñado específicamente para las operaciones de Conserjes Inmobiliarios Ltda.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map(f => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-md hover:border-brand-green/20 transition-all duration-200">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-heading font-bold text-base text-gray-900 mb-2">{f.title}</h3>
                <p className="font-body text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ROLES ── */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            <div className="flex-1">
              <p className="font-body text-sm font-semibold text-brand-green uppercase tracking-widest mb-3">
                Seguridad
              </p>
              <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
                Control de acceso por roles
              </h2>
              <p className="font-body text-gray-500 text-base leading-relaxed mb-6">
                7 niveles de permisos granulares que garantizan que cada persona ve y hace
                exactamente lo que corresponde a su cargo.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { role: 'Super Admin', desc: 'Acceso total al sistema' },
                  { role: 'Admin', desc: 'Gestión operativa completa' },
                  { role: 'Supervisor', desc: 'Supervisión y reportes' },
                  { role: 'Coord. Compras', desc: 'Órdenes y proveedores' },
                  { role: 'Bodeguero', desc: 'Entradas y salidas' },
                  { role: 'Auditor', desc: 'Solo lectura y auditoría' },
                ].map(r => (
                  <div key={r.role} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="w-8 h-8 bg-brand-green/10 rounded-lg flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-brand-green" />
                    </div>
                    <div>
                      <p className="font-body font-semibold text-sm text-gray-900">{r.role}</p>
                      <p className="font-body text-xs text-gray-500">{r.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mockup card */}
            <div className="flex-1 w-full max-w-sm lg:max-w-none">
              <div className="bg-gradient-to-br from-[#1B5E20] to-[#388E3C] rounded-3xl p-6 text-white shadow-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-heading font-bold text-sm">Gestión de Usuarios</p>
                    <p className="font-body text-xs text-green-300">7 roles activos</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { initials: 'JR', name: 'Jorge Ramos', role: 'Bodeguero', sede: 'CA · Bogotá' },
                    { initials: 'MP', name: 'María Pérez', role: 'Supervisora', sede: 'MO · Medellín' },
                    { initials: 'CA', name: 'Carlos A.', role: 'Coord. Compras', sede: 'Admin' },
                  ].map(u => (
                    <div key={u.name} className="flex items-center gap-3 bg-white/10 rounded-xl px-3 py-2.5">
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <span className="font-heading font-bold text-xs">{u.initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-body font-semibold text-sm truncate">{u.name}</p>
                        <p className="font-body text-xs text-green-300">{u.role}</p>
                      </div>
                      <span className="font-body text-xs bg-white/10 px-2 py-0.5 rounded-full">{u.sede}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 sm:py-24 bg-gradient-to-br from-[#1B5E20] via-[#2E7D32] to-[#43A047]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center text-white">
          <h2 className="font-heading font-bold text-3xl sm:text-4xl mb-4">
            ¿Listo para empezar?
          </h2>
          <p className="font-body text-green-100 text-lg mb-8">
            Accede al sistema con tus credenciales corporativas y toma el control de tu inventario.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-3 bg-white text-brand-green font-body font-bold text-lg px-10 py-4 rounded-2xl hover:bg-green-50 transition-all shadow-2xl hover:-translate-y-1 duration-200"
          >
            Ingresar al sistema
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-brand-green rounded-lg flex items-center justify-center">
              <span className="text-white font-heading font-bold text-xs">CI</span>
            </div>
            <span className="font-body text-sm">Conserjes Inmobiliarios Ltda · NIT 800093388-2</span>
          </div>
          <p className="font-body text-xs">© {new Date().getFullYear()} Todos los derechos reservados</p>
        </div>
      </footer>
    </div>
  )
}
