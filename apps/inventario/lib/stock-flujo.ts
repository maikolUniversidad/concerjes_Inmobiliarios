/**
 * Flujo de la mercancía de las órdenes de insumo: qué está por alistar, qué ya
 * se alistó (ordenado, sigue en bodega) y qué ya salió (despachado).
 *
 * Por producto lo calcula la vista `v_stock_flujo`
 * (migración 20261001000000_stock_flujo_ordenes):
 *   por_alistar + alistado = reservado = stock real − disponible real.
 *
 * Aquí solo hay lógica pura (sin React ni Supabase).
 */
import { reservaStock, yaSalio } from './stock-reservas'

/** Fila de `v_stock_flujo` ya convertida a números. */
export interface FlujoProducto {
  porAlistar: number
  /** Ya chuleado en alistamiento: ordenado, aún en bodega. */
  alistado: number
  /** Salió de bodega en el mes en curso (America/Bogota). */
  despachadoMes: number
  /** Despachado y aún sin recibir en la sede (DESPACHADO / EN_RUTA). */
  enTransito: number
  ordenesPorAlistar: number
  ordenesAlistado: number
  ordenesEnTransito: number
}

export const FLUJO_VACIO: FlujoProducto = {
  porAlistar: 0, alistado: 0, despachadoMes: 0, enTransito: 0,
  ordenesPorAlistar: 0, ordenesAlistado: 0, ordenesEnTransito: 0,
}

/** Columnas que se piden a la vista. */
export const SELECT_FLUJO =
  'producto_id, por_alistar, alistado, despachado_mes, en_transito, ordenes_por_alistar, ordenes_alistado, ordenes_en_transito'

export interface FilaFlujoBD {
  producto_id: string
  por_alistar: number | string | null
  alistado: number | string | null
  despachado_mes: number | string | null
  en_transito: number | string | null
  ordenes_por_alistar: number | string | null
  ordenes_alistado: number | string | null
  ordenes_en_transito: number | string | null
}

/** Los `numeric` llegan como string desde PostgREST. */
export function mapaFlujo(filas: readonly FilaFlujoBD[]): Map<string, FlujoProducto> {
  const n = (v: number | string | null) => Number(v ?? 0) || 0
  return new Map(filas.map((f) => [f.producto_id, {
    porAlistar: n(f.por_alistar),
    alistado: n(f.alistado),
    despachadoMes: n(f.despachado_mes),
    enTransito: n(f.en_transito),
    ordenesPorAlistar: n(f.ordenes_por_alistar),
    ordenesAlistado: n(f.ordenes_alistado),
    ordenesEnTransito: n(f.ordenes_en_transito),
  }]))
}

/** Nombre del mes en curso en Bogotá, p. ej. "octubre". */
export function mesActualBogota(ahora = new Date()): string {
  return ahora.toLocaleDateString('es-CO', { month: 'long', timeZone: 'America/Bogota' })
}

const fechaCorta = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'America/Bogota' }) : ''

export type TonoFlujo = 'gris' | 'ambar' | 'azul' | 'verde' | 'cielo' | 'esmeralda'

export interface EtapaOrden {
  /** Texto corto de la celda (también va al Excel / copiado). */
  label: string
  /** Segunda línea (fecha, avance). */
  detalle: string
  tono: TonoFlujo
}

/**
 * Columna "Alistamiento" de una orden.
 *  - pendiente: aún no se empieza (o la orden no ha llegado a bodega);
 *  - en curso: x de y ítems chuleados;
 *  - alistado: con fecha (o "salió" si ya se despachó).
 */
export function etapaAlistamiento(o: {
  estado: string
  totalItems: number
  alistados: number
  alistadoAt?: string | null
  despachadoAt?: string | null
}): EtapaOrden {
  const { estado, totalItems, alistados } = o
  if (estado === 'ANULADA') return { label: 'Anulada', detalle: '', tono: 'gris' }
  if (estado === 'BORRADOR' || estado === 'EN_REVISION' || estado === 'CAMBIOS_SOLICITADOS') {
    return { label: 'Sin aprobar', detalle: '', tono: 'gris' }
  }
  if (yaSalio(estado) || estado === 'ALISTADO') {
    const fecha = fechaCorta(o.alistadoAt ?? o.despachadoAt)
    return { label: 'Alistado', detalle: [fecha, `${alistados}/${totalItems} ítems`].filter(Boolean).join(' · '), tono: 'verde' }
  }
  if (estado === 'EN_ALISTAMIENTO' || alistados > 0) {
    return { label: 'En curso', detalle: `${alistados} de ${totalItems} ítems`, tono: 'azul' }
  }
  return { label: 'Pendiente', detalle: `${totalItems} ítems`, tono: 'ambar' }
}

/** Columna "Despacho" de una orden. */
export function etapaDespacho(o: {
  estado: string
  despachadoAt?: string | null
  tomadoRutaAt?: string | null
  recibidoAt?: string | null
}): EtapaOrden {
  const { estado } = o
  if (estado === 'ANULADA') return { label: 'Anulada', detalle: '', tono: 'gris' }
  if (!yaSalio(estado)) {
    return { label: 'Pendiente', detalle: reservaStock(estado) ? 'en bodega (reservado)' : '', tono: reservaStock(estado) ? 'ambar' : 'gris' }
  }
  const desp = fechaCorta(o.despachadoAt)
  if (estado === 'EN_RUTA') return { label: 'En ruta', detalle: [desp && `desp. ${desp}`, o.tomadoRutaAt && `ruta ${fechaCorta(o.tomadoRutaAt)}`].filter(Boolean).join(' · '), tono: 'cielo' }
  if (estado === 'ENTREGADO') return { label: 'Entregado', detalle: desp && `desp. ${desp}`, tono: 'esmeralda' }
  if (estado === 'RECIBIDO') return { label: 'Recibido', detalle: [desp && `desp. ${desp}`, o.recibidoAt && `rec. ${fechaCorta(o.recibidoAt)}`].filter(Boolean).join(' · '), tono: 'esmeralda' }
  return { label: 'Despachado', detalle: desp, tono: 'verde' }
}

export const CLASE_TONO: Record<TonoFlujo, string> = {
  gris: 'bg-gray-100 text-gray-500',
  ambar: 'bg-amber-100 text-amber-800',
  azul: 'bg-blue-100 text-blue-700',
  verde: 'bg-green-100 text-green-700',
  cielo: 'bg-sky-100 text-sky-700',
  esmeralda: 'bg-emerald-100 text-emerald-800',
}

/** Texto plano de una etapa (filtro, búsqueda, Excel). */
export const textoEtapa = (e: EtapaOrden) => (e.detalle ? `${e.label} · ${e.detalle}` : e.label)

/**
 * Un ítem de una orden: cuánto se pidió, cuánto se alistó y cuánto salió.
 *
 * Ojo: `cantidad_alistada` arranca igual a lo solicitado, así que antes del
 * despacho solo cuenta si el ítem está chuleado (`alistado`). Al despachar, lo
 * no chuleado queda en 0 y `cantidad_alistada` es exactamente lo que salió.
 */
export function flujoItem(it: {
  estado: string
  solicitado: number
  cantidadAlistada: number
  alistado: boolean
}): { pedido: number; alistado: number; despachado: number; porAlistar: number } {
  const pedido = Number(it.solicitado) || 0
  const alist = Number(it.cantidadAlistada) || 0
  if (yaSalio(it.estado)) return { pedido, alistado: alist, despachado: alist, porAlistar: 0 }
  const alistado = it.alistado ? alist : 0
  const porAlistar = reservaStock(it.estado) ? Math.max(0, pedido - alistado) : 0
  return { pedido, alistado, despachado: 0, porAlistar }
}
