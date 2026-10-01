import { traerTodo } from './paginado'
import { mapaFlujo, SELECT_FLUJO, type FilaFlujoBD, type FlujoProducto } from '@/lib/stock-flujo'

/**
 * Lee `v_stock_flujo` completa (paginada) y la devuelve como mapa por
 * producto_id. Solo trae productos con algo en el flujo; el resto es 0.
 * Si la vista falla, devuelve un mapa vacío: las columnas de flujo son
 * informativas y no deben tumbar la pantalla de stock.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function traerFlujoStock(supabase: any): Promise<Map<string, FlujoProducto>> {
  try {
    const filas = await traerTodo<FilaFlujoBD>((desde, hasta) => supabase
      .from('v_stock_flujo' as never)
      .select(SELECT_FLUJO)
      .order('producto_id')
      .range(desde, hasta))
    return mapaFlujo(filas)
  } catch (e) {
    console.error('v_stock_flujo:', e instanceof Error ? e.message : e)
    return new Map()
  }
}
