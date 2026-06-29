import type { Metadata } from 'next'
import {
  Package, TrendingDown, ArrowLeftRight, AlertTriangle,
  TrendingUp, BarChart3, Sparkles,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Dashboard' }

const kpis = [
  {
    label: 'Total Productos',
    value: '—',
    subtext: 'en catálogo activo',
    icon: Package,
    color: 'bg-blue-50 text-blue-600',
    trend: null,
  },
  {
    label: 'Stock Crítico',
    value: '—',
    subtext: 'productos bajo mínimo',
    icon: AlertTriangle,
    color: 'bg-red-50 text-red-600',
    trend: null,
  },
  {
    label: 'Movimientos Hoy',
    value: '—',
    subtext: 'entradas y salidas',
    icon: ArrowLeftRight,
    color: 'bg-green-50 text-green-600',
    trend: null,
  },
  {
    label: 'Valor Inventario',
    value: '—',
    subtext: 'COP estimado',
    icon: TrendingUp,
    color: 'bg-amber-50 text-amber-600',
    trend: null,
  },
]

export default function DashboardPage() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Dashboard</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Bienvenido al panel de control de inventarios
          </p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="font-body text-xs text-gray-400">Conserjes Inmobiliarios Ltda</p>
          <p className="font-body text-xs text-gray-400">NIT 800093388-2</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`w-10 h-10 rounded-xl ${kpi.color} flex items-center justify-center`}>
                <kpi.icon className="w-5 h-5" />
              </div>
            </div>
            <p className="font-heading font-bold text-3xl text-gray-900 mb-1">{kpi.value}</p>
            <p className="font-body font-semibold text-sm text-gray-700">{kpi.label}</p>
            <p className="font-body text-xs text-gray-400 mt-0.5">{kpi.subtext}</p>
          </div>
        ))}
      </div>

      {/* Charts placeholder + IA widget */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Main chart */}
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-heading font-semibold text-lg text-gray-900">Movimientos — últimos 30 días</h2>
            <select className="font-body text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5">
              <option>30 días</option>
              <option>7 días</option>
              <option>90 días</option>
            </select>
          </div>
          <div className="h-56 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
            <BarChart3 className="w-10 h-10 text-gray-300 mb-2" />
            <p className="font-body text-sm text-gray-400">Gráfica Recharts — conectar Supabase</p>
          </div>
        </div>

        {/* IA assistant preview */}
        <div className="bg-gradient-to-br from-brand-green to-brand-green-mid rounded-2xl p-6 text-white shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-green-300" />
            <h3 className="font-heading font-semibold">Asistente IA</h3>
          </div>
          <p className="font-body text-sm text-green-100 leading-relaxed mb-4">
            Pregúntame sobre el inventario en lenguaje natural.
          </p>
          <div className="space-y-2 mb-4">
            {[
              '¿Qué productos están en stock crítico?',
              '¿Cuánto hipoclorito queda?',
              'Genera orden de compra urgente',
            ].map((q) => (
              <button
                key={q}
                className="w-full text-left bg-white/10 hover:bg-white/20 text-green-100 font-body text-xs px-3 py-2 rounded-lg transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
          <a
            href="/ia/asistente"
            className="block text-center bg-white text-brand-green font-body font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-green-50 transition-colors"
          >
            Abrir asistente
          </a>
        </div>
      </div>

      {/* Stock crítico table placeholder */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-semibold text-lg text-gray-900">
            Alertas de stock crítico
          </h2>
          <span className="bg-red-100 text-red-600 text-xs font-body font-semibold px-3 py-1 rounded-full">
            Requiere atención
          </span>
        </div>
        <div className="h-40 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-gray-300 mb-2" />
          <p className="font-body text-sm text-gray-400">Tabla de alertas — conectar Supabase Realtime</p>
        </div>
      </div>
    </div>
  )
}
