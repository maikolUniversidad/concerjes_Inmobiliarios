'use client'

import Link from 'next/link'
import { AlertTriangle, ShoppingCart } from 'lucide-react'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

export interface RecFila {
  producto_id: string
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: string
  precio_lista: number | null
  stock_real: number
  comprometido: number
  oc_pendiente: number
  recomendado: number
}

export interface PlanFila {
  producto_id: string
  codigo: number | null
  nombre: string
  presentacion: string
  cat: string
  stock_real: number
  stock_minimo: number
  pedido_ca: number
  pedido_mo: number
  pedido_mb: number
  pedido_pb: number
  pedido_ad: number
  pedido_calculado: number
  sugerido_compra: number
  oc_pendiente: number
  adicional: number
  total_compras: number
  precio: number
}

function getCatColor(cat: string) {
  return (
    { A: 'bg-green-100 text-green-700', B: 'bg-blue-100 text-blue-700',
      C: 'bg-amber-100 text-amber-700', D: 'bg-red-100 text-red-700' }[cat]
    ?? 'bg-gray-100 text-gray-700'
  )
}

function getStockAlert(real: number, minimo: number) {
  if (real <= 0) return 'text-red-600 font-bold'
  if (real <= minimo) return 'text-red-600'
  if (real <= minimo * 1.5) return 'text-amber-600'
  return 'text-gray-900'
}

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

const miles = (n: number) => Number(n).toLocaleString('es-CO')

/** Recomendación de compra en vivo (vista `v_recomendacion_compra`). */
export function RecomendacionTabla({ recs }: { recs: RecFila[] }) {
  const columnas: ColumnaTabla<RecFila>[] = [
    {
      id: 'producto', header: 'Producto', valor: (r) => r.nombre_estandar, ancho: 'min-w-[200px]', tarjeta: 'titulo',
      celda: (r) => (
        <>
          <p className="font-medium text-gray-900 max-w-[220px] truncate">{r.nombre_estandar}</p>
          {r.presentacion && <p className="text-gray-400">{r.presentacion}</p>}
        </>
      ),
    },
    { id: 'codigo', header: 'Cód', valor: (r) => r.codigo ?? '', prioridad: 3, className: 'font-mono text-gray-500', tarjeta: 'meta' },
    {
      id: 'cat', header: 'Cat.', valor: (r) => r.cat_rotacion, align: 'center', prioridad: 2, tarjeta: 'meta',
      celda: (r) => <span className={`font-bold px-1.5 py-0.5 rounded ${getCatColor(r.cat_rotacion)}`}>{r.cat_rotacion}</span>,
    },
    { id: 'stock', header: 'Stock', valor: (r) => Number(r.stock_real), align: 'right', className: 'text-gray-700', tarjeta: 'meta',
      celda: (r) => <>{miles(r.stock_real)}</> },
    { id: 'demanda', header: 'Demanda', valor: (r) => Number(r.comprometido), align: 'right', prioridad: 2, className: 'text-gray-500', tarjeta: 'meta',
      celda: (r) => <>{miles(r.comprometido)}</> },
    {
      id: 'oc', header: 'OC pend.', valor: (r) => Number(r.oc_pendiente), align: 'right', prioridad: 3, className: 'text-amber-600', tarjeta: 'oculto',
      celda: (r) => <>{Number(r.oc_pendiente) > 0 ? miles(r.oc_pendiente) : '—'}</>,
    },
    {
      id: 'recomendado', header: 'Recomendado', valor: (r) => Number(r.recomendado), align: 'right', tarjeta: 'badge',
      className: 'font-bold text-brand-green bg-green-50/60', headerClassName: 'bg-green-50 text-brand-green',
      celda: (r) => <>{miles(r.recomendado)}</>,
    },
    {
      id: 'valor', header: 'Valor est.', align: 'right', prioridad: 2, className: 'text-gray-600', tarjeta: 'meta',
      valor: (r) => Number(r.recomendado) * Number(r.precio_lista ?? 0),
      copiaTexto: (r) => String(Number(r.recomendado) * Number(r.precio_lista ?? 0)),
      celda: (r) => <>{r.precio_lista ? formatCOP(Number(r.recomendado) * Number(r.precio_lista)) : '—'}</>,
    },
  ]

  return (
    <TablaEstandar
      id="aprov-recomendacion"
      titulo="Recomendación de compra"
      modulo="Compras"
      entidad="v_recomendacion_compra"
      datos={recs}
      columnas={columnas}
      filaId={(r) => r.producto_id}
      busqueda="Buscar producto…"
      anchoAcciones="w-28"
      acciones={(r) => (
        <Link href={`/ordenes-compra/nuevo?producto=${r.producto_id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-body font-semibold text-[11px] text-gray-600 hover:border-brand-green hover:text-brand-green hover:bg-green-50 transition-colors">
          <ShoppingCart className="w-3 h-3" /> Crear OC
        </Link>
      )}
      vacio={
        <p className="font-body text-sm text-gray-400">
          No hay recomendaciones: el stock (más lo ya pedido) cubre la demanda comprometida. 👍
        </p>
      }
    />
  )
}

/** Plan de reabastecimiento del periodo (datos CMI). */
export function PlanReabastecimientoTabla({ rows, periodo }: { rows: PlanFila[]; periodo: string }) {
  const columnas: ColumnaTabla<PlanFila>[] = [
    { id: 'codigo', header: 'Cód', valor: (r) => r.codigo ?? '', ancho: 'w-16', className: 'font-mono text-gray-500', prioridad: 2, tarjeta: 'meta' },
    {
      id: 'producto', header: 'Producto', valor: (r) => r.nombre, ancho: 'min-w-[200px]', tarjeta: 'titulo',
      celda: (r) => (
        <>
          <p className="font-medium text-gray-900 max-w-[200px] truncate">{r.nombre}</p>
          <p className="text-gray-400">{r.presentacion}</p>
        </>
      ),
    },
    { id: 'presentacion', header: 'Presentación', valor: (r) => r.presentacion, prioridad: 3, className: 'text-gray-400', tarjeta: 'subtitulo' },
    {
      id: 'cat', header: 'Cat.', valor: (r) => r.cat, align: 'center', prioridad: 2, tarjeta: 'meta',
      celda: (r) => <span className={`font-bold px-1.5 py-0.5 rounded ${getCatColor(r.cat)}`}>{r.cat}</span>,
    },
    {
      id: 'stock', header: 'Stock', valor: (r) => r.stock_real, align: 'right', tarjeta: 'meta',
      className: 'bg-blue-50/30', headerClassName: 'bg-blue-50/50',
      celda: (r) => (
        <span className={`font-bold ${getStockAlert(r.stock_real, r.stock_minimo)}`}>
          {r.stock_real}
          {r.stock_real <= r.stock_minimo && r.stock_minimo > 0 && (
            <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />
          )}
        </span>
      ),
    },
    { id: 'minimo', header: 'Mín.', valor: (r) => r.stock_minimo, align: 'right', prioridad: 3, className: 'text-gray-500 bg-blue-50/30', headerClassName: 'bg-blue-50/50', tarjeta: 'oculto' },
    { id: 'ca', header: 'C.A.', valor: (r) => r.pedido_ca, align: 'right', prioridad: 3, className: 'bg-blue-50/20', headerClassName: 'bg-blue-50 text-blue-600', tarjeta: 'oculto' },
    { id: 'mo', header: 'M.O.', valor: (r) => r.pedido_mo, align: 'right', prioridad: 3, className: 'bg-purple-50/20', headerClassName: 'bg-purple-50 text-purple-600', tarjeta: 'oculto' },
    { id: 'mb', header: 'M.B.', valor: (r) => r.pedido_mb, align: 'right', prioridad: 3, className: 'bg-green-50/20', headerClassName: 'bg-green-50 text-green-600', tarjeta: 'oculto' },
    { id: 'pb', header: 'P.B.', valor: (r) => r.pedido_pb, align: 'right', prioridad: 3, className: 'bg-orange-50/20', headerClassName: 'bg-orange-50 text-orange-600', tarjeta: 'oculto' },
    { id: 'ad', header: 'A.D.', valor: (r) => r.pedido_ad, align: 'right', prioridad: 3, className: 'bg-gray-50', headerClassName: 'bg-gray-100', tarjeta: 'oculto' },
    { id: 'calc', header: 'Ped. calc.', valor: (r) => r.pedido_calculado, align: 'right', prioridad: 2, className: 'font-semibold text-gray-700', tarjeta: 'meta' },
    { id: 'sugerido', header: 'Sug. compra', valor: (r) => r.sugerido_compra, align: 'right', prioridad: 3, className: 'font-semibold', tarjeta: 'oculto' },
    { id: 'ocpend', header: 'OC pend.', valor: (r) => r.oc_pendiente, align: 'right', prioridad: 3, className: 'text-amber-600', tarjeta: 'oculto' },
    { id: 'adicional', header: 'Adicional', valor: (r) => r.adicional, align: 'right', prioridad: 3, tarjeta: 'oculto' },
    {
      id: 'total', header: 'Total', valor: (r) => r.total_compras, align: 'right', tarjeta: 'badge',
      className: 'bg-green-50/50 font-bold', headerClassName: 'bg-green-50 text-brand-green',
      celda: (r) => (
        <span className={r.total_compras > 0 ? 'text-brand-green' : 'text-gray-300'}>
          {r.total_compras > 0 ? r.total_compras : '—'}
        </span>
      ),
    },
    {
      id: 'valor', header: 'Valor', align: 'right', prioridad: 2, className: 'text-gray-600', tarjeta: 'meta',
      valor: (r) => r.total_compras * r.precio,
      copiaTexto: (r) => String(r.total_compras * r.precio),
      celda: (r) => <>{r.total_compras > 0 && r.precio > 0 ? formatCOP(r.total_compras * r.precio) : '—'}</>,
    },
  ]

  return (
    <TablaEstandar
      id="aprov-plan"
      titulo="Plan de reabastecimiento"
      modulo="Compras"
      entidad="aprovisionamiento"
      datos={rows}
      columnas={columnas}
      filaId={(r) => r.producto_id}
      busqueda="Buscar producto, código o categoría…"
      filaClassName={(r) => (r.stock_real <= r.stock_minimo && r.stock_minimo > 0 ? 'bg-red-50/30' : '')}
      vacio={
        <>
          <p className="font-heading font-bold text-gray-400">Sin datos de aprovisionamiento para {periodo}</p>
          <p className="font-body text-sm text-gray-400 mt-1">Ejecuta el script de carga o genera el plan desde la hoja CMI</p>
        </>
      }
    />
  )
}
