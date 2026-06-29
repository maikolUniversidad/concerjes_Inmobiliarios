import type { Metadata } from 'next'
import { Package, AlertTriangle, TrendingUp, ArrowLeftRight, Boxes } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { CategoriaRotacion, TipoInsumo } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Reportes' }
export const revalidate = 60

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

interface Prod {
  tipo_insumo: TipoInsumo
  cat_rotacion: CategoriaRotacion
  stock_minimo_def: number
  precio_lista: number | null
  stock: { cantidad_real: number } | null
}

export default async function ReportesPage() {
  const supabase = await createClient()

  const { data: prodRaw } = await supabase
    .from('productos')
    .select('tipo_insumo, cat_rotacion, stock_minimo_def, precio_lista, stock ( cantidad_real )')
    .eq('activo', true)
  const productos = (prodRaw as unknown as Prod[]) ?? []

  const desde = new Date(); desde.setDate(desde.getDate() - 30)
  const { count: movs30 } = await supabase
    .from('movimientos')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', desde.toISOString())

  const totalProductos = productos.length
  const valorInventario = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0)
  const unidades = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0), 0)
  const criticos = productos.filter(p => p.stock_minimo_def > 0 && (p.stock?.cantidad_real ?? 0) <= p.stock_minimo_def).length

  // Por tipo de insumo
  const porTipo = new Map<string, number>()
  productos.forEach(p => porTipo.set(p.tipo_insumo, (porTipo.get(p.tipo_insumo) ?? 0) + 1))
  const tipos = [...porTipo.entries()].sort((a, b) => b[1] - a[1])
  const maxTipo = Math.max(1, ...tipos.map(t => t[1]))

  // Por categoría de rotación
  const cats: CategoriaRotacion[] = ['A', 'B', 'C', 'D']
  const porCat = cats.map(c => ({ cat: c, n: productos.filter(p => p.cat_rotacion === c).length }))

  const kpis = [
    { label: 'Productos activos', value: totalProductos.toLocaleString('es-CO'), icon: Package, color: 'bg-blue-50 text-blue-600' },
    { label: 'Unidades en stock', value: unidades.toLocaleString('es-CO'), icon: Boxes, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Valor inventario', value: cop.format(valorInventario), icon: TrendingUp, color: 'bg-amber-50 text-amber-600' },
    { label: 'Stock crítico', value: criticos.toString(), icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
    { label: 'Movimientos (30d)', value: (movs30 ?? 0).toLocaleString('es-CO'), icon: ArrowLeftRight, color: 'bg-green-50 text-green-600' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Reportes</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Indicadores del inventario en tiempo real</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-xl ${k.color} flex items-center justify-center mb-3`}>
              <k.icon className="w-4.5 h-4.5" />
            </div>
            <p className="font-heading font-bold text-xl text-gray-900">{k.value}</p>
            <p className="font-body text-xs text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Por tipo de insumo */}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="font-heading font-semibold text-lg text-gray-900 mb-4">Productos por tipo de insumo</h2>
          <div className="space-y-3">
            {tipos.map(([tipo, n]) => (
              <div key={tipo}>
                <div className="flex justify-between font-body text-xs text-gray-600 mb-1">
                  <span>{tipo}</span><span className="font-semibold">{n}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-green rounded-full" style={{ width: `${(n / maxTipo) * 100}%` }} />
                </div>
              </div>
            ))}
            {tipos.length === 0 && <p className="font-body text-sm text-gray-400">Sin datos</p>}
          </div>
        </div>

        {/* Por categoría */}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="font-heading font-semibold text-lg text-gray-900 mb-4">Distribución por rotación (A/B/C/D)</h2>
          <div className="grid grid-cols-4 gap-3">
            {porCat.map(({ cat, n }) => (
              <div key={cat} className="text-center rounded-xl border border-gray-100 p-4">
                <p className="font-heading font-bold text-2xl text-gray-900">{n}</p>
                <p className="font-body text-xs text-gray-500 mt-1">Cat. {cat}</p>
              </div>
            ))}
          </div>
          <p className="font-body text-xs text-gray-400 mt-4">
            La categoría A corresponde a productos de alta rotación; D a no disponibles.
          </p>
        </div>
      </div>
    </div>
  )
}
