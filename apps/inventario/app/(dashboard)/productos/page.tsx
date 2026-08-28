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
  const perm = await requirePermiso('ver_productos')
  const supabase = await createClient()

  const SELECT = `
    id, ref, codigo, nombre_estandar, presentacion,
    tipo_insumo, cat_rotacion, stock_minimo_def, imagen_url, activo,
    sku, codigo_barras, cce_tipo,
    inventario_periodo, inventario_encontrado,
    stock ( cantidad_real, cantidad_disp ),
    cce:cce_bien_id ( id, item, bien ),
    stock_cce ( cantidad_real, cantidad_disp )
  `
  // Paginar para traer TODOS los productos activos (Supabase limita a 1000 por request)
  const PAGE = 1000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let productos: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let error: any = null
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await supabase
      .from('productos')
      .select(SELECT)
      .eq('activo', true)
      .order('ref', { ascending: false })
      .range(from, from + PAGE - 1)
    if (e) { error = e; break }
    productos = productos.concat(data ?? [])
    if (!data || data.length < PAGE) break
  }
  const total = productos.length

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
            {total} productos activos · base de datos en tiempo real
          </p>
        </div>
        <div className="flex gap-2">
          {perm.puede('exportar_datos') && (
            <button className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
              <Download className="w-4 h-4" />
              Exportar
            </button>
          )}
          {perm.puede('editar_productos') && (
          <Link
            href="/productos/nuevo"
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo producto
          </Link>
          )}
        </div>
      </div>

      <ProductosClient productos={productos} total={total} />
    </div>
  )
}
