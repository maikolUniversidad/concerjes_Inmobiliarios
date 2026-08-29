import Link from 'next/link'
import { ClipboardList, CalendarDays, Star, DollarSign, Clock, CheckCircle2, AlertCircle, TrendingUp, Wallet, SlidersHorizontal, FileText, Gift } from 'lucide-react'
import { getResumenServiciosHogar, getSolicitudesRecientes } from './actions'
import { getResumenPagos } from './pagos-actions'

const ESTADOS: Record<string, { label: string; cls: string }> = {
  PENDIENTE:   { label: 'Pendiente',   cls: 'bg-yellow-100 text-yellow-700' },
  CONFIRMADA:  { label: 'Confirmada',  cls: 'bg-blue-100 text-blue-700' },
  EN_SERVICIO: { label: 'En servicio', cls: 'bg-purple-100 text-purple-700' },
  COMPLETADA:  { label: 'Completada',  cls: 'bg-green-100 text-green-700' },
  CANCELADA:   { label: 'Cancelada',   cls: 'bg-red-100 text-red-700' },
}

export default async function ServiciosHogarPage() {
  const [resumen, recientes, pagos] = await Promise.all([
    getResumenServiciosHogar().catch(() => ({ pendientes: 0, confirmadas: 0, hoy: 0, completadas: 0 })),
    getSolicitudesRecientes().catch(() => []),
    getResumenPagos().catch(() => ({ porCobrar: 0, saldoPendiente: 0, vencidos: 0, porVerificar: 0, recaudado: 0 })),
  ])

  const moneda = (v: number) => `$${Number(v ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`

  const tarjetas = [
    { label: 'Pendientes',  value: resumen.pendientes, icon: AlertCircle,    cls: 'text-yellow-600', bg: 'bg-yellow-50',  href: '/servicios-hogar/solicitudes?estado=PENDIENTE' },
    { label: 'Confirmadas', value: resumen.confirmadas, icon: CheckCircle2,  cls: 'text-blue-600',   bg: 'bg-blue-50',    href: '/servicios-hogar/solicitudes?estado=CONFIRMADA' },
    { label: 'Hoy',         value: resumen.hoy,          icon: Clock,         cls: 'text-purple-600', bg: 'bg-purple-50',  href: '/servicios-hogar/agenda' },
    { label: 'Completadas', value: resumen.completadas,  icon: TrendingUp,    cls: 'text-green-600',  bg: 'bg-green-50',   href: '/servicios-hogar/solicitudes?estado=COMPLETADA' },
  ]

  const tarjetasPago = [
    { label: 'Por cobrar',    value: moneda(pagos.saldoPendiente),   sub: `${pagos.porCobrar} cuenta(s)`, icon: Wallet,        cls: 'text-yellow-600', bg: 'bg-yellow-50', href: '/servicios-hogar/pagos?estado=EMITIDO' },
    { label: 'Vencidas',      value: String(pagos.vencidos),          sub: 'cuentas sin pagar',            icon: AlertCircle,   cls: 'text-red-600',    bg: 'bg-red-50',    href: '/servicios-hogar/pagos?estado=EMITIDO' },
    { label: 'Por verificar', value: String(pagos.porVerificar),       sub: 'pagos reportados',             icon: FileText,      cls: 'text-blue-600',   bg: 'bg-blue-50',   href: '/servicios-hogar/pagos' },
    { label: 'Recaudado',     value: moneda(pagos.recaudado),          sub: 'cuentas pagadas',              icon: CheckCircle2,  cls: 'text-green-600',  bg: 'bg-green-50',  href: '/servicios-hogar/pagos?estado=PAGADO' },
  ]

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Servicios del Hogar</h1>
        <p className="text-gray-500 text-sm mt-1">Panel de gestión de solicitudes y servicios domésticos</p>
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tarjetas.map((t) => {
          const Icon = t.icon
          return (
            <Link key={t.label} href={t.href}
              className={`${t.bg} rounded-2xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow`}>
              <div className={`w-10 h-10 rounded-xl ${t.bg} flex items-center justify-center border border-white/60 shadow-sm`}>
                <Icon className={`w-5 h-5 ${t.cls}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{t.value}</p>
                <p className="text-sm text-gray-500">{t.label}</p>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Cartera y pagos */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-3">Cartera y pagos</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tarjetasPago.map((t) => {
            const Icon = t.icon
            return (
              <Link key={t.label} href={t.href}
                className={`${t.bg} rounded-2xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow`}>
                <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
                  <Icon className={`w-5 h-5 ${t.cls}`} />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900">{t.value}</p>
                  <p className="text-sm text-gray-500">{t.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.sub}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { href: '/servicios-hogar/solicitudes', icon: ClipboardList, label: 'Solicitudes',         desc: 'Ver y gestionar todas las solicitudes' },
          { href: '/servicios-hogar/agenda',      icon: CalendarDays,  label: 'Agenda',              desc: 'Calendario semanal de servicios' },
          { href: '/servicios-hogar/tipos',       icon: Star,          label: 'Tipos de servicio',   desc: 'Catálogo y descripción de servicios' },
          { href: '/servicios-hogar/precios',     icon: DollarSign,    label: 'Precios y tarifas',   desc: 'Gestionar precios por duración y frecuencia' },
          { href: '/servicios-hogar/pagos',       icon: Wallet,        label: 'Pagos',               desc: 'Cuentas de cobro, verificación y cartera' },
          { href: '/servicios-hogar/parametros-pago', icon: SlidersHorizontal, label: 'Parámetros de pago', desc: 'IVA, plazos, anticipos y formas de pago' },
          { href: '/servicios-hogar/puntos',      icon: Gift,          label: 'Puntos y recompensas', desc: 'Reglas del programa, catálogo y canjes' },
        ].map((a) => {
          const Icon = a.icon
          return (
            <Link key={a.href} href={a.href}
              className="bg-white border border-gray-100 rounded-2xl p-5 hover:border-green-200 hover:shadow-md transition-all group">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center mb-3 group-hover:bg-green-100 transition-colors">
                <Icon className="w-5 h-5 text-brand-green" />
              </div>
              <p className="font-semibold text-gray-900 text-sm">{a.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{a.desc}</p>
            </Link>
          )
        })}
      </div>

      {/* Solicitudes recientes */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Solicitudes recientes</h2>
          <Link href="/servicios-hogar/solicitudes" className="text-sm text-brand-green hover:underline font-medium">
            Ver todas →
          </Link>
        </div>
        {recientes.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            Aún no hay solicitudes. Cuando los clientes soliciten servicios aparecerán aquí.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recientes.map((s: any) => {
              const est = ESTADOS[s.estado] ?? { label: s.estado, cls: 'bg-gray-100 text-gray-600' }
              return (
                <Link key={s.id} href={`/servicios-hogar/solicitudes`}
                  className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors">
                  <span className="text-2xl">{s.tipos_servicio_hogar?.icono ?? '🏠'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 truncate">{s.cliente_nombre}</span>
                      <span className="text-xs text-gray-400 font-mono shrink-0">{s.numero}</span>
                    </div>
                    <p className="text-xs text-gray-500">{s.tipos_servicio_hogar?.nombre} · {s.fecha_deseada} {s.hora_inicio?.slice(0,5)}</p>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${est.cls}`}>{est.label}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
