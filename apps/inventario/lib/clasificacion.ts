// Clasificación de contratos: tipo (Directo/Privado) + etiquetas por categorías.
// Tipos y helpers compartidos entre el módulo de Contratos y los módulos que
// condicionan por esta clasificación (Reportes, Movimientos, Aprovisionamiento…).

export type TipoContrato = 'DIRECTO' | 'PRIVADO'

export const TIPO_CONTRATO_META: Record<TipoContrato, { label: string; badge: string }> = {
  DIRECTO: { label: 'Directo', badge: 'bg-emerald-100 text-emerald-700' },
  PRIVADO: { label: 'Privado', badge: 'bg-violet-100 text-violet-700' },
}

export const TIPO_CONTRATO_OPCIONES: { value: TipoContrato; label: string }[] = [
  { value: 'DIRECTO', label: 'Directo' },
  { value: 'PRIVADO', label: 'Privado' },
]

// Paleta de colores para categorías/etiquetas (nombre → clases badge y punto).
export const ETIQUETA_COLORES: Record<string, { badge: string; dot: string }> = {
  gray:   { badge: 'bg-gray-100 text-gray-700',       dot: 'bg-gray-400' },
  red:    { badge: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
  amber:  { badge: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  green:  { badge: 'bg-green-100 text-green-700',     dot: 'bg-green-500' },
  emerald:{ badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  blue:   { badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  violet: { badge: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500' },
  pink:   { badge: 'bg-pink-100 text-pink-700',       dot: 'bg-pink-500' },
  teal:   { badge: 'bg-teal-100 text-teal-700',       dot: 'bg-teal-500' },
}
export const ETIQUETA_COLOR_NOMBRES = Object.keys(ETIQUETA_COLORES)
export const colorEtiqueta = (c?: string | null) => ETIQUETA_COLORES[c ?? 'gray'] ?? ETIQUETA_COLORES.gray

export interface Etiqueta { id: string; categoria_id: string; nombre: string; color: string | null; orden?: number }
export interface Categoria { id: string; nombre: string; descripcion: string | null; color: string; multiple: boolean; orden?: number }
