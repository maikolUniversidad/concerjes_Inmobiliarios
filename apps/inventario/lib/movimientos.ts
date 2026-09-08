import type { OpcionFiltroExtra } from '@/lib/clasificacion'
import type { TipoMovimiento } from '@/lib/types/database'

// Nombre y color de cada tipo de movimiento. Vive aquí —y no en el cliente de
// la pantalla— porque la página servidor también lo necesita para declarar el
// filtro extra que alimenta el resumen y las vistas rápidas. Los iconos se
// quedan en el cliente: no cruzan la frontera servidor/cliente.

export const TIPO_MOV_META: Record<TipoMovimiento, Required<OpcionFiltroExtra>> = {
  ENTRADA: { label: 'Entrada', badge: 'bg-green-100 text-green-700' },
  SALIDA: { label: 'Salida', badge: 'bg-orange-100 text-orange-700' },
  DEVOLUCION: { label: 'Devolución', badge: 'bg-blue-100 text-blue-700' },
  AJUSTE: { label: 'Ajuste', badge: 'bg-purple-100 text-purple-700' },
  TRASLADO: { label: 'Traslado', badge: 'bg-gray-100 text-gray-600' },
}

export const ORDEN_TIPOS_MOV: TipoMovimiento[] = ['ENTRADA', 'SALIDA', 'DEVOLUCION', 'AJUSTE', 'TRASLADO']

/** Parámetro de URL con el tipo de movimiento seleccionado. */
export const CLAVE_TIPO_MOV = 'mov'

/** Normaliza el valor de ?mov=: sólo tipos conocidos, si no, "todos". */
export function leerTipoMov(valor: string | null | undefined): TipoMovimiento | null {
  const v = String(valor ?? '').toUpperCase()
  return v in TIPO_MOV_META ? (v as TipoMovimiento) : null
}
