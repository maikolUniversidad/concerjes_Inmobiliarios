import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Package, ArrowLeftRight, AlertTriangle, TrendingUp, Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { MovimientosChart, type ChartPoint } from './MovimientosChart'

export const metadata: Metadata = { title: 'Dashboard' }
export const revalidate = 30

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

interface ProductoDash {
  id: string
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: CategoriaRotacion
  stock_minimo_def: number
  precio_lista: number | null
  stock: { cantidad_real: number; cantidad_disp: number } | null
}

function startOfDay(offsetDays = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - offsetDays)
  return d
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // Productos + stock (para KPIs y alertas)
  const { data: productosRaw } = await supabase
    .from('productos')
    .select('id, nombre_estandar, presentacion, cat_rotacion, stock_minimo_def, precio_lista, stock ( cantidad_real, cantidad_disp )')
    .eq('activo', true)

  const productos = (productosRaw ?? []) as unknown as ProductoDash[]

  // Movimientos últimos 14 días
  const desde = startOfDay(13)
  const { data: movsRaw } = await supabase
    .from('movimientos')
    .select('tipo, cantidad, created_at')
    .gte('created_at', desde.toISOString())

  const movs = (movsRaw ?? []) as unknown as { tipo: string; cantidad: number; created_at: string }[]

  // ---- KPIs ----
  const totalProductos = productos.length
  const criticos = productos.filter(p => {
    const real = p.stock?.cantidad_real ?? 0
    return p.stock_minimo_def > 0 && real <= p.stock_minimo_def
  })
  const hoy = startOfDay(0)
  const movimientosHoy = movs.filter(m => new Date(m.created_at) >= hoy).length
  const valorInventario = productos.reduce(
    (acc, p) => acc + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0,
  )

  const kpis = [
    { label: 'Total Productos', value: totalProductos.toLocaleString('es-CO'), subtext: 'en catálogo activo', icon: Package, color: 'bg-blue-50 text-blue-600' },
    { label: 'Stock Crítico', value: criticos.length.toLocaleString('es-CO'), subtext: 'productos bajo mínimo', icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
    { label: 'Movimientos Hoy', value: movimientosHoy.toLocaleString('es-CO'), subtext: 'entradas y salidas', icon: ArrowLeftRight, color: 'bg-green-50 text-green-600' },
    { label: 'Valor Inventario', value: cop.format(valorInventario), subtext: 'COP estimado', icon: TrendingUp, color: 'bg-amber-50 text-amber-600' },
  ]

  // ---- Datos de la gráfica (14 días) ----
  const dias: ChartPoint[] = []
  for (let i = 13; i >= 0; i--) {
    const d = startOfDay(i)
    const next = startOfDay(i - 1)
    const enRango = movs.filter(m => {
      const t = new Date(m.created_at)
      return t >= d && t < next
    })
    dias.push({
      dia: d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }),
      entradas: enRango.filter(m => m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCION').reduce((a, m) => a + Number(m.cantidad), 0),
      salidas: enRango.filter(m => m.tipo === 'SALIDA').reduce((a, m) => a + Number(m.cantidad), 0),
    })
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Dashboard</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">Bienvenido al panel de control de inventarios</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="font-body text-xs text-gray-400">Conserjes Inmobiliarios Ltda</p>
          <p className="font-body text-xs text-gray-400">NIT 800093388-2</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
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

      {/* Chart + IA widget */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-heading font-semibold text-lg text-gray-900">Movimientos — últimos 14 días</h2>
          </div>
          <MovimientosChart data={dias} />
        </div>

        <div className="bg-gradient-to-br from-brand-green to-brand-green-mid rounded-2xl p-6 text-white shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-green-300" />
            <h3 className="font-heading font-semibold">Asistente IA</h3>
          </div>
          <p className="font-body text-sm text-green-100 leading-relaxed mb-4">
            Pregúntame sobre el inventario en lenguaje natural.
          </p>
          <Link href="/ia/asistente" className="block text-center bg-white text-brand-green font-body font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-green-50 transition-colors">
            Abrir asistente
          </Link>
        </div>
      </div>

      {/* Stock crítico */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-semibold text-lg text-gray-900">Alertas de stock crítico</h2>
          <span className="bg-red-100 text-red-600 text-xs font-body font-semibold px-3 py-1 rounded-full">
            {criticos.length} requieren atención
          </span>
        </div>

        {criticos.length === 0 ? (
          <div className="h-32 bg-green-50/50 rounded-xl border border-green-100 flex flex-col items-center justify-center text-green-700">
            <Package className="w-8 h-8 mb-2 opacity-60" />
            <p className="font-body text-sm">Todo el inventario está por encima del mínimo ✅</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Producto</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Cat.</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Disponible</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Mínimo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {criticos.slice(0, 8).map(p => {
                  const cat = CATEGORIA_LABELS[p.cat_rotacion]
                  const real = p.stock?.cantidad_real ?? 0
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2.5">
                        <Link href={`/productos/${p.id}`} className="font-body font-medium text-sm text-gray-900 hover:text-brand-green">
                          {p.nombre_estandar}
                        </Link>
                        <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-body font-bold text-xs px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>{p.cat_rotacion}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-heading font-bold text-base ${real === 0 ? 'text-red-600' : 'text-orange-600'}`}>{real}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-body text-sm text-gray-500">{p.stock_minimo_def}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {criticos.length > 8 && (
              <p className="font-body text-xs text-gray-400 mt-3 text-center">
                + {criticos.length - 8} productos más en estado crítico
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
