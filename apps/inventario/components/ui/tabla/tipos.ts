import type { ReactNode } from 'react'

/** Valores planos que viajan a los filtros, al orden y al portapapeles. */
export type ValorCelda = string | number | boolean | null | undefined

export type AlineacionColumna = 'left' | 'center' | 'right'

/**
 * Rol de la columna cuando la tabla se pinta como tarjetas (móvil o vista
 * "Tarjetas"). Si no se declara, las dos primeras columnas hacen de título y
 * subtítulo y el resto cae en `meta`.
 */
export type RolTarjeta = 'titulo' | 'subtitulo' | 'badge' | 'meta' | 'cuerpo' | 'oculto'

export interface ColumnaTabla<T> {
  /** Identificador estable; se usa en filtros, orden y preferencias guardadas. */
  id: string
  header: string
  /** Valor plano de la celda: filtro, búsqueda, orden y copiado salen de aquí. */
  valor: (fila: T) => ValorCelda
  /** Pintado enriquecido. Por defecto se muestra `valor`. */
  celda?: (fila: T) => ReactNode
  /** Texto exacto que se pega en Excel. Por defecto, `valor` formateado. */
  copiaTexto?: (fila: T) => string
  align?: AlineacionColumna
  /** 1 = siempre visible · 2 = se oculta en móvil · 3 = solo pantallas grandes. */
  prioridad?: 1 | 2 | 3
  /** Por defecto true. */
  ordenable?: boolean
  /** Por defecto true. */
  filtrable?: boolean
  /** Por defecto true. Las columnas de acciones o iconos deben ir en false. */
  copiable?: boolean
  /**
   * La celda trae controles (input, checkbox, botón). Queda fuera de la
   * selección de rango para no robarle el clic al control, y su texto sí se
   * puede seleccionar con el mouse.
   */
  interactiva?: boolean
  /** Ubicación dentro de la tarjeta. */
  tarjeta?: RolTarjeta
  className?: string
  headerClassName?: string
  /** Clase de ancho, ej. 'w-12' o 'min-w-[220px]'. */
  ancho?: string
}

export type Vista = 'tabla' | 'tarjetas'

export type DireccionOrden = 'asc' | 'desc'

export interface OrdenTabla {
  columna: string
  direccion: DireccionOrden
}

/** Filtro interno de una columna: texto "contiene" + valores marcados. */
export interface FiltroColumna {
  texto: string
  valores: string[] | null
}

/** Selección rectangular estilo hoja de cálculo (índices sobre lo visible). */
export interface RangoSeleccion {
  filaInicio: number
  colInicio: number
  filaFin: number
  colFin: number
}

export interface BloqueCopiado {
  encabezados: string[]
  filas: string[][]
}

export function textoDeValor(valor: ValorCelda): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  return String(valor)
}
