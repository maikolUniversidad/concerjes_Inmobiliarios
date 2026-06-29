import {
  AlertTriangle, BarChart3, ShoppingCart, TrendingUp, Boxes, Sparkles,
  type LucideIcon,
} from 'lucide-react'

export interface PreguntaCategoria {
  id: string
  titulo: string
  icon: LucideIcon
  color: string
  preguntas: string[]
}

/**
 * Preguntas predeterminadas para orientar al usuario sobre qué puede consultar.
 * Se muestran en el estado vacío del chat agrupadas por categoría.
 */
export const PREGUNTAS_SUGERIDAS: PreguntaCategoria[] = [
  {
    id: 'stock',
    titulo: 'Stock y alertas',
    icon: AlertTriangle,
    color: 'text-red-600 bg-red-50 border-red-100',
    preguntas: [
      '¿Qué productos están en stock crítico ahora mismo?',
      '¿Cuáles productos están agotados?',
      'Muéstrame una gráfica de los 10 productos con menor stock',
      '¿Cuánto stock disponible hay por categoría de rotación?',
    ],
  },
  {
    id: 'compras',
    titulo: 'Compras y aprovisionamiento',
    icon: ShoppingCart,
    color: 'text-blue-600 bg-blue-50 border-blue-100',
    preguntas: [
      'Genera un plan de compra para los productos bajo mínimo',
      '¿Cuánto costaría reabastecer todo el stock crítico?',
      '¿Qué productos debería pedir esta semana?',
      'Resume el aprovisionamiento sugerido por proveedor',
    ],
  },
  {
    id: 'analisis',
    titulo: 'Análisis y reportes',
    icon: BarChart3,
    color: 'text-purple-600 bg-purple-50 border-purple-100',
    preguntas: [
      'Gráfica del valor del inventario por categoría',
      '¿Cuáles son los 5 insumos más valiosos del inventario?',
      'Compara stock disponible vs. mínimo de los productos clave',
      'Dame un resumen ejecutivo del estado del inventario',
    ],
  },
  {
    id: 'general',
    titulo: 'Operación general',
    icon: Boxes,
    color: 'text-green-600 bg-green-50 border-green-100',
    preguntas: [
      '¿Cuántos productos activos hay en catálogo?',
      '¿Cuál es el valor total estimado del inventario?',
      'Explícame cómo interpretar las categorías A, B, C y D',
      '¿Qué puedo preguntarte sobre el inventario?',
    ],
  },
]

/** Atajos rápidos (chips) para el estado vacío y la barra de sugerencias. */
export const PREGUNTAS_RAPIDAS: string[] = [
  '¿Qué productos están en stock crítico?',
  'Gráfica de stock por categoría',
  'Genera plan de compra urgente',
  'Resumen ejecutivo del inventario',
  '¿Cuáles son los insumos más usados?',
]

export { Sparkles, TrendingUp }
