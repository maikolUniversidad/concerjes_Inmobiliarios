import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ProductoDetalle } from './ProductoDetalle'
import type { Producto, Stock, Proveedor, Movimiento } from '@/lib/types/database'

interface Props { params: Promise<{ id: string }> }

type UbicacionRel = {
  codigo: string
  nombre: string | null
  tipo: string | null
  foto_url: string | null
  pos_x: number | null
  pos_y: number | null
  bodega: { nombre: string; plano_url: string | null } | null
}

type ProductoConRelaciones = Producto & {
  stock: Stock | null
  proveedor: Pick<Proveedor,'nombre'|'telefono'|'email'> | null
  proveedor2: Pick<Proveedor,'nombre'> | null
  ubicacion: UbicacionRel | null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('productos').select('nombre_estandar').eq('id', id).single()
  return { title: (data as { nombre_estandar: string } | null)?.nombre_estandar ?? 'Producto' }
}

export default async function ProductoPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('productos')
    .select(`
      id, ref, codigo, nombre_estandar, presentacion, complemento,
      tipo_insumo, cat_rotacion, stock_minimo_def, stock_minimo_asig, stock_min_suger,
      ind_rot_general, ind_rot_mes, precio_lista, precio_lista2, imagen_url, activo,
      sku, ubicacion_bodega, bodega_descripcion,
      codigo_barras, codigo_barras_formato, codigo_barras_origen,
      created_at, updated_at,
      stock ( cantidad_real, cantidad_disp, cantidad_entr, cantidad_sal, updated_at ),
      proveedor:proveedor_id ( nombre, telefono, email ),
      proveedor2:proveedor2_id ( nombre ),
      ubicacion:ubicacion_id ( codigo, nombre, tipo, foto_url, pos_x, pos_y, bodega:bodega_id ( nombre, plano_url ) )
    `)
    .eq('id', id)
    .single()

  if (error || !data) notFound()
  const producto = data as unknown as ProductoConRelaciones

  const [{ data: movs }, { data: fotosData }] = await Promise.all([
    supabase.from('movimientos')
      .select('tipo, cantidad, created_at, observacion')
      .eq('producto_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('producto_fotos')
      .select('id, url, storage_path, orden, es_principal')
      .eq('producto_id', id)
      .order('orden'),
  ])

  const movimientos = (movs ?? []) as Pick<Movimiento,'tipo'|'cantidad'|'observacion'|'created_at'>[]
  const fotos = (fotosData ?? []) as { id: string; url: string; storage_path: string | null; orden: number; es_principal: boolean }[]

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <Link href="/productos"
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Productos
        </Link>
        <span className="text-gray-300">/</span>
        <span className="font-body text-sm text-gray-900 truncate max-w-[250px]">
          {producto.nombre_estandar}
        </span>
      </div>

      <ProductoDetalle producto={producto} movimientos={movimientos} fotos={fotos} />
    </div>
  )
}
