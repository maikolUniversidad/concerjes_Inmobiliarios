// Tipos y catálogo del diseñador de planos de bodega.
// Coordenadas y medidas SIEMPRE en metros; el editor las escala a píxeles.

export type ElementoTipo =
  | 'ESTANTE' | 'ALMACEN' | 'PASILLO' | 'PUERTA' | 'ESCALERA' | 'RAMPA'
  | 'PARED' | 'VENTANA' | 'COLUMNA' | 'NEVERA' | 'PALLET' | 'VITRINA'
  | 'OFICINA' | 'BANO' | 'ZONA_CARGA' | 'EXTINTOR' | 'ETIQUETA'

export interface PlanoElemento {
  id: string
  tipo: ElementoTipo
  x: number          // metros (esquina sup-izq)
  y: number          // metros
  w: number          // ancho en metros
  h: number          // alto en metros
  rot: number        // grados
  etiqueta?: string
  color?: string     // override opcional
  ubicacion_id?: string | null // enlace a una ubicación real (estantes)
}

export interface PlanoPiso {
  id: string
  bodega_id: string
  numero: number
  nombre: string | null
  ancho_m: number
  alto_m: number
  escala: number
  fondo_url: string | null
  elementos: PlanoElemento[]
  orden: number
}

export interface ElementoConfig {
  label: string
  color: string        // relleno por defecto
  borde: string        // color de borde
  w: number            // ancho por defecto (m)
  h: number            // alto por defecto (m)
  categoria: 'Almacenamiento' | 'Estructura' | 'Accesos' | 'Equipos' | 'Áreas'
  /** Decoración especial del render */
  render?: 'puerta' | 'escalera' | 'rampa' | 'columna' | 'ventana' | 'etiqueta'
}

export const ELEMENTOS: Record<ElementoTipo, ElementoConfig> = {
  // Almacenamiento
  ESTANTE:   { label: 'Estante',        color: '#bfdbfe', borde: '#3b82f6', w: 2,   h: 0.6, categoria: 'Almacenamiento' },
  ALMACEN:   { label: 'Zona almacén',   color: '#bbf7d0', borde: '#22c55e', w: 3,   h: 3,   categoria: 'Almacenamiento' },
  PALLET:    { label: 'Pallet',         color: '#fed7aa', borde: '#f97316', w: 1.2, h: 1,   categoria: 'Almacenamiento' },
  NEVERA:    { label: 'Nevera',         color: '#a5f3fc', borde: '#06b6d4', w: 1,   h: 0.8, categoria: 'Almacenamiento' },
  VITRINA:   { label: 'Vitrina',        color: '#fbcfe8', borde: '#ec4899', w: 2,   h: 0.5, categoria: 'Almacenamiento' },
  // Estructura
  PARED:     { label: 'Pared',          color: '#374151', borde: '#111827', w: 4,   h: 0.2, categoria: 'Estructura' },
  COLUMNA:   { label: 'Columna',        color: '#9ca3af', borde: '#4b5563', w: 0.4, h: 0.4, categoria: 'Estructura', render: 'columna' },
  VENTANA:   { label: 'Ventana',        color: '#bae6fd', borde: '#0ea5e9', w: 1.2, h: 0.15, categoria: 'Estructura', render: 'ventana' },
  // Accesos
  PUERTA:    { label: 'Puerta',         color: '#fde68a', borde: '#f59e0b', w: 0.9, h: 0.15, categoria: 'Accesos', render: 'puerta' },
  ESCALERA:  { label: 'Escalera',       color: '#ddd6fe', borde: '#8b5cf6', w: 1.2, h: 3,   categoria: 'Accesos', render: 'escalera' },
  RAMPA:     { label: 'Rampa',          color: '#e9d5ff', borde: '#a855f7', w: 2,   h: 4,   categoria: 'Accesos', render: 'rampa' },
  PASILLO:   { label: 'Pasillo',        color: '#f3f4f6', borde: '#d1d5db', w: 2,   h: 6,   categoria: 'Accesos' },
  ZONA_CARGA:{ label: 'Zona de carga',  color: '#fecaca', borde: '#ef4444', w: 4,   h: 3,   categoria: 'Accesos' },
  // Áreas
  OFICINA:   { label: 'Oficina',        color: '#fef3c7', borde: '#f59e0b', w: 3,   h: 3,   categoria: 'Áreas' },
  BANO:      { label: 'Baño',           color: '#bae6fd', borde: '#0284c7', w: 2,   h: 2,   categoria: 'Áreas' },
  // Equipos / anotaciones
  EXTINTOR:  { label: 'Extintor',       color: '#fca5a5', borde: '#dc2626', w: 0.3, h: 0.3, categoria: 'Equipos' },
  ETIQUETA:  { label: 'Etiqueta/Texto', color: 'transparent', borde: '#9ca3af', w: 2, h: 0.6, categoria: 'Áreas', render: 'etiqueta' },
}

export const CATEGORIAS: ElementoConfig['categoria'][] = ['Almacenamiento', 'Estructura', 'Accesos', 'Áreas', 'Equipos']
