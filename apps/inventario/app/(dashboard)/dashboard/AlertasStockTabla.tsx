'use client'

import Link from 'next/link'
import { Package } from 'lucide-react'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

export interface CriticoFila {
  id: string
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: CategoriaRotacion
  stock_minimo_def: number
  real: number
}

export function AlertasStockTabla({ criticos }: { criticos: CriticoFila[] }) {
  const columnas: ColumnaTabla<CriticoFila>[] = [
    {
      id: 'producto', header: 'Producto', valor: (p) => p.nombre_estandar, tarjeta: 'titulo',
      ancho: 'min-w-[200px]',
      celda: (p) => (
        <>
          <Link href={`/productos/${p.id}`} onClick={(e) => e.stopPropagation()}
            className="font-body font-medium text-sm text-gray-900 hover:text-brand-green">
            {p.nombre_estandar}
          </Link>
          <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
        </>
      ),
    },
    { id: 'presentacion', header: 'Presentación', valor: (p) => p.presentacion ?? '', prioridad: 3, className: 'text-xs text-gray-400', tarjeta: 'subtitulo' },
    {
      id: 'cat', header: 'Cat.', valor: (p) => p.cat_rotacion, align: 'center', prioridad: 2, tarjeta: 'meta',
      celda: (p) => {
        const cat = CATEGORIA_LABELS[p.cat_rotacion]
        return <span className={`font-body font-bold text-xs px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>{p.cat_rotacion}</span>
      },
    },
    {
      id: 'disponible', header: 'Disponible', valor: (p) => p.real, align: 'right', tarjeta: 'meta',
      celda: (p) => (
        <span className={`font-heading font-bold text-base ${p.real === 0 ? 'text-red-600' : 'text-orange-600'}`}>{p.real}</span>
      ),
    },
    { id: 'minimo', header: 'Mínimo', valor: (p) => p.stock_minimo_def, align: 'right', className: 'text-gray-500', tarjeta: 'meta' },
  ]

  if (criticos.length === 0) {
    return (
      <div className="h-32 bg-green-50/50 rounded-xl border border-green-100 flex flex-col items-center justify-center text-green-700">
        <Package className="w-8 h-8 mb-2 opacity-60" />
        <p className="font-body text-sm">Todo el inventario está por encima del mínimo ✅</p>
      </div>
    )
  }

  return (
    <TablaEstandar
      id="dashboard-criticos"
      titulo="Alertas de stock crítico"
      modulo="Inventario"
      entidad="stock"
      datos={criticos}
      columnas={columnas}
      filaId={(p) => p.id}
      busqueda="Buscar producto…"
      filasPorPagina={8}
    />
  )
}
