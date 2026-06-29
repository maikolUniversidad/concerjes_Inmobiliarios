import type { SupabaseClient } from '@supabase/supabase-js'
import type { UbicacionOption } from './ProductoForm'

interface UbicRow {
  id: string
  codigo: string
  nombre: string | null
  tipo: string | null
  foto_url: string | null
  pos_x: number | null
  pos_y: number | null
  bodega: { id: string; nombre: string; plano_url: string | null } | null
}

/** Carga las ubicaciones activas (con su bodega) para relacionarlas a un producto. */
export async function cargarUbicaciones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<UbicacionOption[]> {
  const { data } = await supabase
    .from('ubicaciones')
    .select('id, codigo, nombre, tipo, foto_url, pos_x, pos_y, bodega:bodega_id ( id, nombre, plano_url )')
    .eq('activo', true)
    .order('codigo')

  return ((data as unknown as UbicRow[]) ?? [])
    .filter(u => u.bodega)
    .map(u => ({
      id: u.id,
      codigo: u.codigo,
      nombre: u.nombre,
      tipo: u.tipo,
      foto_url: u.foto_url,
      pos_x: u.pos_x,
      pos_y: u.pos_y,
      bodega_id: u.bodega!.id,
      bodega_nombre: u.bodega!.nombre,
      bodega_plano_url: u.bodega!.plano_url,
    }))
}
