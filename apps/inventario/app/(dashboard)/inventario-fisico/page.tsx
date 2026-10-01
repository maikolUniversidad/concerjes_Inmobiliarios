import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { ordenCronologico, type InventarioFisico, type ItemFisico } from '@/lib/inventario-fisico'
import { InventarioFisicoClient } from './InventarioFisicoClient'

export const metadata: Metadata = { title: 'Inventario físico' }
export const revalidate = 0

export default async function InventarioFisicoPage() {
  const permisos = await requirePermiso('ver_inventario_fisico')
  const supabase = await createClient()

  const { data: invs, error } = await supabase
    .from('inventarios_fisicos' as never)
    .select('id, periodo, fecha_corte, archivo_nombre, observacion, historico, total_items, items_con_cantidad, items_en_cero, total_unidades, items_nuevos, items_ajustados, items_no_hallados, created_at')
    .order('fecha_corte', { ascending: true })
    .order('created_at', { ascending: true })

  let items: ItemFisico[] = []
  let errorItems: string | null = null
  try {
    // Todos los conteos juntos superan las 1.000 filas de PostgREST
    items = await traerTodo<ItemFisico>((desde, hasta) => supabase
      .from('inventario_fisico_items' as never)
      .select('inventario_id, producto_id, codigo, nombre, presentacion, estado, cantidad_contada, stock_sistema, diferencia, precio_unitario, producto_nuevo')
      .order('id')
      .range(desde, hasta) as never)
  } catch (e) {
    errorItems = e instanceof Error ? e.message : String(e)
  }

  if (error || errorItems) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando los inventarios: {error?.message ?? errorItems}
        </div>
      </div>
    )
  }

  // numeric llega como string desde PostgREST
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  // Cronológico por fecha de corte (no por el nombre del periodo: "AGOSTO 2025" llegó después de "JULIO 2026")
  const inventarios = ordenCronologico(((invs ?? []) as unknown as InventarioFisico[]).map(i => ({ ...i, total_unidades: Number(i.total_unidades) })))
  const limpios = items.map(i => ({
    ...i,
    cantidad_contada: n(i.cantidad_contada),
    stock_sistema: n(i.stock_sistema),
    diferencia: n(i.diferencia),
    precio_unitario: n(i.precio_unitario),
  }))

  return (
    <InventarioFisicoClient
      inventarios={inventarios}
      items={limpios}
      puedeCargar={permisos.puede('cargar_inventario_fisico')}
    />
  )
}
