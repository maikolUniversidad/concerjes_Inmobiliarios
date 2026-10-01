import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { ordenCronologico, type InventarioFisico, type ItemFisico } from '@/lib/inventario-fisico'
import { InformeCargueClient } from './InformeCargueClient'

export const metadata: Metadata = { title: 'Informe de inventario físico' }
export const revalidate = 0

interface Props { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// numeric llega como string desde PostgREST
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export default async function InformeCarguePage({ params }: Props) {
  await requirePermiso('ver_inventario_fisico')
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()

  const { data: invs, error } = await supabase
    .from('inventarios_fisicos' as never)
    .select('id, periodo, fecha_corte, archivo_nombre, observacion, historico, total_items, items_con_cantidad, items_en_cero, total_unidades, items_nuevos, items_ajustados, items_no_hallados, created_at')
    .order('fecha_corte', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return <AvisoError mensaje={error.message} />

  const inventarios = ordenCronologico(((invs ?? []) as unknown as InventarioFisico[])
    .map(i => ({ ...i, total_unidades: Number(i.total_unidades) })))
  const pos = inventarios.findIndex(i => i.id === id)
  if (pos < 0) notFound()

  // Solo el conteo actual y los anteriores (por fecha de corte) entran al informe
  const ids = inventarios.slice(0, pos + 1).map(i => i.id)
  let items: ItemFisico[]
  try {
    items = await traerTodo<ItemFisico>((desde, hasta) => supabase
      .from('inventario_fisico_items' as never)
      .select('inventario_id, producto_id, codigo, nombre, presentacion, estado, cantidad_contada, stock_sistema, diferencia, precio_unitario, producto_nuevo')
      .in('inventario_id', ids)
      .order('id')
      .range(desde, hasta) as never, { etiqueta: 'Ítems de los conteos' })
  } catch (e) {
    return <AvisoError mensaje={e instanceof Error ? e.message : String(e)} />
  }

  const limpios = items.map(i => ({
    ...i,
    cantidad_contada: n(i.cantidad_contada),
    stock_sistema: n(i.stock_sistema),
    diferencia: n(i.diferencia),
    precio_unitario: n(i.precio_unitario),
  }))

  return <InformeCargueClient inventarios={inventarios} items={limpios} id={id} />
}

function AvisoError({ mensaje }: { mensaje: string }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
        Error cargando el informe: {mensaje}
      </div>
    </div>
  )
}
