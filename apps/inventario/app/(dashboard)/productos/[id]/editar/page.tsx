import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ProductoForm, type ProductoDefaults } from '../../ProductoForm'
import { actualizarProducto } from '../../actions'

export const metadata: Metadata = { title: 'Editar producto' }

interface Props { params: Promise<{ id: string }> }

export default async function EditarProductoPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data, error }, { data: proveedores }] = await Promise.all([
    supabase.from('productos')
      .select('id, nombre_estandar, presentacion, tipo_insumo, cat_rotacion, stock_minimo_def, precio_lista, proveedor_id, ref, codigo, complemento, imagen_url')
      .eq('id', id).single(),
    supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  if (error || !data) notFound()
  const defaults = data as unknown as ProductoDefaults

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href={`/productos/${id}`} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver al producto
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Editar producto</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">{defaults.nombre_estandar}</p>
      </div>

      <ProductoForm action={actualizarProducto} proveedores={proveedores ?? []} defaults={defaults} submitLabel="Guardar cambios" modo="editar" />
    </div>
  )
}
