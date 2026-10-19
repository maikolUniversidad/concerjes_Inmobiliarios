import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { ordenarPorItem } from '@/lib/stock-reservas'
import { SobrePedidos, type ProductoSobrePedido, type OrdenDemanda } from './SobrePedidos'

/**
 * Panel de productos sobre-pedidos.
 *
 * Va aparte y dentro de un <Suspense> a propósito: es la parte más pesada de la
 * pantalla y la menos urgente. Así la tabla de órdenes se pinta de una vez y
 * este bloque llega después, en vez de que todo el mundo espere a que termine.
 *
 * Si falla, NO tumba la pantalla: el listado de órdenes es lo que la gente vino
 * a ver. Antes cualquier error aquí hacía caer toda la página en el aviso de
 * "Esta pantalla no se pudo cargar".
 */
export async function SobrePedidosPanel() {
  const supabase = await createClient()

  // Disponible proyectado = stock real − lo pedido en órdenes que aún NO salen
  // de bodega. Si es negativo, se pidió de más. Ojo al leer el reporte: el
  // faltante NO es la suma de las órdenes, es esa suma MENOS el stock.
  //
  // La vista v_sobre_pedidos ya trae las órdenes de cada producto agregadas en
  // JSON. Antes esto eran 5 peticiones (déficit + códigos por lotes de 60 +
  // demanda por lotes, paginada) y ~2.800 filas sueltas que se volvían a cruzar
  // en memoria.
  let filas: Array<{
    producto_id: string; codigo: number | null; nombre_estandar: string | null
    presentacion: string | null; stock_real: number; comprometido: number; disponible: number
    ordenes: OrdenDemanda[] | null
  }> = []

  try {
    filas = await traerTodo((desde, hasta) => supabase
      .from('v_sobre_pedidos')
      .select('producto_id, codigo, nombre_estandar, presentacion, stock_real, comprometido, disponible, ordenes')
      .order('producto_id')
      .range(desde, hasta))
  } catch (e) {
    console.error('[ordenes-insumo] no se pudo cargar sobre-pedidos', e)
    return null
  }

  // Orden por código de ítem y luego alfabético (la misma regla de todo el sistema).
  const items: ProductoSobrePedido[] = ordenarPorItem(filas, (r) => ({ codigo: r.codigo, nombre: r.nombre_estandar }))
    .map((r) => ({
      producto_id: r.producto_id,
      codigo: r.codigo ?? null,
      nombre: r.nombre_estandar ?? 'Producto',
      presentacion: r.presentacion ?? null,
      stock_real: Number(r.stock_real),
      comprometido: Number(r.comprometido),
      disponible: Number(r.disponible),
      ordenes: (r.ordenes ?? []).map((o) => ({ ...o, cantidad: Number(o.cantidad) })),
    }))

  return <SobrePedidos items={items} />
}
