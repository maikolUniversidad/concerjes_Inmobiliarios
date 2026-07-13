import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { OCDetalleClient, type OCDetalle, type OCItem, type OCEvento } from './OCDetalleClient'

export const metadata: Metadata = { title: 'Orden de Compra' }
export const dynamic = 'force-dynamic'

export default async function OCDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermiso('ver_ordenes_compra')
  const { id } = await params
  const supabase = await createClient()

  const { data: oc } = await supabase
    .from('ordenes_compra')
    .select('*, proveedor:proveedores ( nombre, telefono, email )')
    .eq('id', id)
    .single()
  if (!oc) notFound()

  const [{ data: items }, { data: eventos }] = await Promise.all([
    supabase.from('oc_items').select('id, cantidad_ped, cantidad_rec, precio_unit, subtotal, producto:productos ( nombre_estandar, presentacion )').eq('oc_id', id),
    supabase.from('oc_eventos').select('*').eq('oc_id', id).order('created_at', { ascending: false }),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/ordenes-compra" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm">
        <ArrowLeft className="w-4 h-4" /> Órdenes de compra
      </Link>
      <OCDetalleClient
        oc={oc as unknown as OCDetalle}
        items={(items as unknown as OCItem[]) ?? []}
        eventos={(eventos as unknown as OCEvento[]) ?? []}
      />
    </div>
  )
}
