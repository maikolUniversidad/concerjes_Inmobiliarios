/**
 * Stock disponible real y orden estándar de las tablas de inventario.
 *
 * REGLA (la aplica la BD: migración 20260928100000_stock_disponible_reservas):
 *  - BORRADOR no reserva.
 *  - Desde que la orden sale de borrador (EN_REVISION, CAMBIOS_SOLICITADOS,
 *    APROBADA, PENDIENTE, EN_ALISTAMIENTO, ALISTADO) su `cantidad_solicitada`
 *    queda RESERVADA: sigue físicamente en bodega pero ya está comprometida.
 *  - Al DESPACHAR la reserva se libera y el stock real baja (movimiento SALIDA).
 *    DESPACHADO, EN_RUTA, ENTREGADO, RECIBIDO = la mercancía ya salió.
 *  - ANULADA libera la reserva.
 *
 *  stock.cantidad_real = físico en bodega
 *  stock.cantidad_disp = real − reservado (negativo ⇒ se pidió más de lo que hay)
 */

export const ESTADOS_RESERVAN = [
  'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
  'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO',
] as const

export const ESTADOS_YA_SALIO = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO'] as const

export const reservaStock = (estado: string) => (ESTADOS_RESERVAN as readonly string[]).includes(estado)
export const yaSalio = (estado: string) => (ESTADOS_YA_SALIO as readonly string[]).includes(estado)

/**
 * Pedido de una orden frente al inventario, para UN ítem.
 *
 *  - `reservadoTotal`: todo lo reservado del producto (incluida esta orden si reserva).
 *  - `disponibleParaOrden`: real − lo reservado por OTRAS órdenes (lo que esta
 *    orden podría llevarse).
 *  - `diferencia`: disponibleParaOrden − pedido. Negativo ⇒ falta mercancía
 *    para cumplir este pedido respetando los demás ya aprobados.
 *
 * Si la orden ya salió (despachada o después) el ítem ya no reserva y la
 * diferencia no aplica (`null`).
 */
export function pedidoVsInventario(args: {
  estado: string
  pedido: number
  real: number
  /** stock.cantidad_disp (real − todo lo reservado). */
  disp: number
}) {
  const { estado, pedido, real, disp } = args
  const reservadoTotal = real - disp
  const propio = reservaStock(estado) ? pedido : 0
  const disponibleParaOrden = disp + propio
  const salio = yaSalio(estado)
  return {
    real,
    reservadoTotal,
    reservadoOtras: reservadoTotal - propio,
    disponibleParaOrden,
    diferencia: salio || estado === 'ANULADA' ? null : disponibleParaOrden - pedido,
    reservaEsta: propio > 0,
    salio,
  }
}

/**
 * Orden de las tablas: por ítem (productos.codigo, ascendente, sin código al
 * final) y luego por nombre alfabético.
 */
export function compararPorItem(
  a: { codigo?: number | string | null; nombre?: string | null },
  b: { codigo?: number | string | null; nombre?: string | null },
): number {
  const ca = a.codigo === null || a.codigo === undefined || a.codigo === '' ? null : Number(a.codigo)
  const cb = b.codigo === null || b.codigo === undefined || b.codigo === '' ? null : Number(b.codigo)
  if (ca !== null && cb === null) return -1
  if (ca === null && cb !== null) return 1
  if (ca !== null && cb !== null && ca !== cb) {
    if (Number.isNaN(ca) || Number.isNaN(cb)) return String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true })
    return ca - cb
  }
  return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es', { sensitivity: 'base', numeric: true })
}

/** Ordena una copia por ítem y luego alfabético. */
export function ordenarPorItem<T>(filas: readonly T[], clave: (f: T) => { codigo?: number | string | null; nombre?: string | null }): T[] {
  return [...filas].sort((x, y) => compararPorItem(clave(x), clave(y)))
}
