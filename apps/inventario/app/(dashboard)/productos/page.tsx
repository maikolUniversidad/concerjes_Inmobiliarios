import type { Metadata } from 'next'
import { Plus, Download } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { ProductosClient } from './ProductosClient'

export const metadata: Metadata = { title: 'Productos' }
export const revalidate = 30

export default async function ProductosPage() {
  await requirePermiso('ver_productos')
  const supabase = await createClient()

  const { data: productos, error } = await supabase
    .from('productos')
    .select(`
      id, ref, codigo, nombre_estandar, presentacion,
      tipo_insumo, cat_rotacion, stock_minimo_def, imagen_url, activo,
      stock ( cantidad_real, cantidad_disp )
    `)
    .eq('activo', true)
    .order('ref', { ascending: false })

  const { count: total } = await supabase
    .from('productos')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando productos: {error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Catálogo de Productos</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {total ?? productos?.length ?? 0} productos · base de datos en tiempo real
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            Exportar
          </button>
          <Link
            href="/productos/nuevo"
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo producto
          </Link>
        </div>
      </div>

      <ProductosClient productos={productos ?? []} total={total ?? 0} />
    </div>
  )
}
