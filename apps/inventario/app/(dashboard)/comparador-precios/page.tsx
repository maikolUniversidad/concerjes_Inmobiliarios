import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { ComparadorClient, type ProductoPrecios, type ProveedorLite, type SinProveedorFila } from './ComparadorClient'

export const metadata: Metadata = { title: 'Comparador de precios · Proveedores' }
export const dynamic = 'force-dynamic'

export default async function ComparadorPreciosPage() {
  await requirePermiso('ver_proveedores')
  const supabase = await createClient()

  const [productos, { data: proveedores }, { data: sinProveedorData }] = await Promise.all([
    // Paginado: PostgREST devuelve máximo 1.000 filas por respuesta.
    traerTodo((desde, hasta) => supabase
      .from('productos')
      .select(
        'id, ref, codigo, nombre_estandar, presentacion, tipo_insumo, precio_lista, ' +
        'proveedor_id, precio_lista2, proveedor2_id, ' +
        'precios_proveedor(id, proveedor_id, precio, vigente, fecha_cotiz)',
      )
      .eq('activo', true)
      .order('nombre_estandar').order('id')
      .range(desde, hasta)),
    supabase.from('proveedores').select('id, nombre, es_principal').eq('activo', true).order('nombre'),
    // Productos que NO pueden convertirse en orden de compra: sin precio vigente
    // en el comparador y sin proveedor en la ficha. La vista trae además cuánto
    // se pidió y cuánto se movió en 6 meses, para poder empezar por los que
    // pesan en vez de por los primeros alfabéticamente.
    supabase
      .from('v_productos_sin_proveedor')
      .select('producto_id, pedido_6m, movimientos_6m, recomendado')
      .order('producto_id'),
  ])

  // numeric → Number: PostgREST devuelve los numeric como texto.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sinProveedor: SinProveedorFila[] = ((sinProveedorData ?? []) as any[]).map((r) => ({
    producto_id: r.producto_id,
    pedido_6m: Number(r.pedido_6m ?? 0),
    movimientos_6m: Number(r.movimientos_6m ?? 0),
    recomendado: Number(r.recomendado ?? 0),
  }))

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
        sinProveedor={sinProveedor}
      />
    </div>
  )
}
