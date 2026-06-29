import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ProductoForm } from '../ProductoForm'
import { crearProducto } from '../actions'
import { cargarUbicaciones } from '../ubicaciones'

export const metadata: Metadata = { title: 'Nuevo producto' }

export default async function NuevoProductoPage() {
  const supabase = await createClient()
  const [{ data: proveedores }, ubicaciones] = await Promise.all([
    supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre'),
    cargarUbicaciones(supabase),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/productos" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a productos
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Nuevo producto</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Registra un nuevo insumo en el catálogo maestro</p>
      </div>

      <ProductoForm action={crearProducto} proveedores={proveedores ?? []} ubicaciones={ubicaciones} submitLabel="Guardar producto" modo="crear" />
    </div>
  )
}
