/**
 * Solicitud de compra (fase 2 del módulo de compras).
 *
 * Etiquetas, colores y lógica pura compartidas por la pantalla, el detalle y
 * los paneles de generación. Los valores coinciden con los enums de la base
 * (`origen_solicitud_compra`, `estado_solicitud_compra`,
 * `prioridad_solicitud_compra`).
 */

export type OrigenSolicitud = 'RECOMENDACION' | 'PENDIENTE_DESPACHO' | 'MANUAL'
export type EstadoSolicitud = 'BORRADOR' | 'ENVIADA' | 'PARCIAL' | 'CONVERTIDA' | 'RECHAZADA' | 'ANULADA'
export type PrioridadSolicitud = 'BAJA' | 'NORMAL' | 'ALTA' | 'URGENTE'

export const ORIGEN_META: Record<OrigenSolicitud, { label: string; detalle: string }> = {
  RECOMENDACION: {
    label: 'Recomendación',
    detalle: 'El stock y lo ya pedido en OC no cubren la demanda comprometida.',
  },
  PENDIENTE_DESPACHO: {
    label: 'Pendiente de despacho',
    detalle: 'Una sede se quedó sin su insumo porque no había stock.',
  },
  MANUAL: { label: 'Manual', detalle: 'La pidió una persona.' },
}

export const ESTADO_META: Record<EstadoSolicitud, { label: string; cls: string; activo: boolean }> = {
  BORRADOR:   { label: 'Borrador',          cls: 'bg-gray-100 text-gray-600',       activo: true },
  ENVIADA:    { label: 'Enviada a compras', cls: 'bg-blue-100 text-blue-700',       activo: true },
  PARCIAL:    { label: 'Parcial',           cls: 'bg-amber-100 text-amber-700',     activo: true },
  CONVERTIDA: { label: 'Convertida en OC',  cls: 'bg-green-100 text-green-700',     activo: false },
  RECHAZADA:  { label: 'Rechazada',         cls: 'bg-red-100 text-red-700',         activo: false },
  ANULADA:    { label: 'Anulada',           cls: 'bg-red-50 text-red-600',          activo: false },
}

export const PRIORIDAD_META: Record<PrioridadSolicitud, { label: string; cls: string; orden: number }> = {
  URGENTE: { label: 'Urgente', cls: 'bg-red-100 text-red-700',       orden: 1 },
  ALTA:    { label: 'Alta',    cls: 'bg-orange-100 text-orange-700', orden: 2 },
  NORMAL:  { label: 'Normal',  cls: 'bg-gray-100 text-gray-600',     orden: 3 },
  BAJA:    { label: 'Baja',    cls: 'bg-gray-50 text-gray-500',      orden: 4 },
}

/** De dónde salió el precio con el que se valoró el ítem. */
export const FUENTE_PRECIO_LABEL: Record<string, string> = {
  COMPARADOR: 'Comparador de precios',
  LISTA: 'Precio de lista',
  SIN_PRECIO: 'Sin precio',
}

export const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0)

export const miles = (n: number) => Number(n ?? 0).toLocaleString('es-CO')

/**
 * Estados de una orden pendiente por falta de stock en los que todavía tiene
 * sentido comprarle: los de antes de que salga de la bodega. Si ya se despachó,
 * el stock apareció y no hay nada que pedir.
 *
 * Es la MISMA lista que usan `v_sc_pendientes_sin_solicitud` y
 * `sc_generar_desde_pendiente` en la base. Si cambia allá, cambia aquí.
 */
export const ESTADOS_PENDIENTE_SOLICITABLE = [
  'BORRADOR', 'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA', 'PENDIENTE', 'EN_ALISTAMIENTO',
] as const

/**
 * ¿La solicitud todavía tiene algo por convertir en orden de compra?
 * BORRADOR, ENVIADA y PARCIAL sí; CONVERTIDA, RECHAZADA y ANULADA no.
 */
export const puedeConvertirse = (estado: EstadoSolicitud) =>
  estado === 'BORRADOR' || estado === 'ENVIADA' || estado === 'PARCIAL'

/**
 * Orden de los productos en cualquier listado: por ítem (código) y después
 * alfabético, como en el resto de la app.
 */
export function ordenarProductos<T extends { codigo?: number | null; nombre?: string | null }>(filas: T[]): T[] {
  return [...filas].sort((a, b) => {
    const ca = Number(a.codigo ?? Number.MAX_SAFE_INTEGER)
    const cb = Number(b.codigo ?? Number.MAX_SAFE_INTEGER)
    if (ca !== cb) return ca - cb
    return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')
  })
}
