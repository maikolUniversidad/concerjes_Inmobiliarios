import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { ComparadorClient, type ProductoPrecios, type ProveedorLite } from './ComparadorClient'

export const metadata: Metadata = { title: 'Comparador de precios · Proveedores' }
export const dynamic = 'force-dynamic'

export default async function ComparadorPreciosPage() {
  await requirePermiso('ver_proveedores')
  const supabase = await createClient()

  const [{ data: productos }, { data: proveedores }] = await Promise.all([
    supabase
      .from('productos')
      .select(
        'id, ref, codigo, nombre_estandar, presentacion, tipo_insumo, precio_lista, ' +
        'proveedor_id, precio_lista2, proveedor2_id, ' +
        'precios_proveedor(id, proveedor_id, precio, vigente, fecha_cotiz)',
      )
      .eq('activo', true)
      .order('nombre_estandar'),
    supabase.from('proveedores').select('id, nombre, es_principal').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Comparador de precios</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Relación productos ↔ proveedores: compara precios entre proveedores del mismo producto y crea órdenes de compra al mejor precio.
        </p>
      </div>

      <ComparadorClient
        productos={(productos ?? []) as unknown as ProductoPrecios[]}
        proveedores={(proveedores ?? []) as ProveedorLite[]}
      />
    </div>
  )
}
