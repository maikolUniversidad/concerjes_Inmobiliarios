import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { OCForm } from '../OCForm'

export const metadata: Metadata = { title: 'Nueva orden de compra' }

export default async function NuevaOCPage({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string; producto?: string; precio?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const [{ data: proveedores }, { data: productos }] = await Promise.all([
    supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('productos').select('id, nombre_estandar, presentacion, precio_lista, precios:precios_proveedor ( proveedor_id, precio )').eq('activo', true).order('nombre_estandar'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/ordenes-compra" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a órdenes
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Nueva orden de compra</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Selecciona el proveedor y agrega los ítems a comprar</p>
      </div>

      <OCForm
        proveedores={proveedores ?? []}
        productos={(productos as never) ?? []}
        initial={{ proveedor_id: sp.proveedor, producto_id: sp.producto, precio: sp.precio }}
      />
    </div>
  )
}
