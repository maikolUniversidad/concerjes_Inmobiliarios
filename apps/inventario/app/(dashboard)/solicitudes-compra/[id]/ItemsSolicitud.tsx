'use client'

import Link from 'next/link'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import { FUENTE_PRECIO_LABEL, formatCOP, miles } from '@/lib/solicitudes-compra'

export interface ItemSolicitud {
  id: string
  codigo: number | null
  nombre: string
  presentacion: string | null
  cantidad: number
  cantidad_convertida: number
  precio_ref: number | null
  fuente_precio: string | null
  justificacion: string | null
  proveedor: string | null
  orden_insumo_id: string | null
  orden_insumo: string | null
  oc_id: string | null
  oc: string | null
}

export function ItemsSolicitud({ items, sinPrecio }: { items: ItemSolicitud[]; sinPrecio: number }) {
  const columnas: ColumnaTabla<ItemSolicitud>[] = [
    { id: 'codigo', header: 'Ítem', valor: (i) => i.codigo ?? '', ancho: 'w-16', className: 'font-mono text-gray-500', prioridad: 2, tarjeta: 'meta' },
    {
      id: 'producto', header: 'Producto', valor: (i) => i.nombre, ancho: 'min-w-[200px]', tarjeta: 'titulo',
      celda: (i) => (
        <>
          <p className="font-medium text-gray-900">{i.nombre}</p>
          {i.presentacion && <p className="text-gray-400">{i.presentacion}</p>}
        </>
      ),
    },
    {
      id: 'cantidad', header: 'Cantidad', valor: (i) => i.cantidad, align: 'right', tarjeta: 'badge',
      className: 'font-bold text-gray-900', celda: (i) => <>{miles(i.cantidad)}</>,
    },
    {
      // `valor` nunca vacío: en tarjetas, una columna sin valor desaparece.
      id: 'proveedor', header: 'Proveedor', valor: (i) => i.proveedor ?? 'Por definir', prioridad: 2, tarjeta: 'meta',
      celda: (i) => <>{i.proveedor ?? <span className="text-orange-500">por definir</span>}</>,
    },
    {
      id: 'precio', header: 'Precio ref.', valor: (i) => i.precio_ref ?? 0, align: 'right', prioridad: 2, tarjeta: 'meta',
      copiaTexto: (i) => (i.precio_ref == null ? '' : String(i.precio_ref)),
      celda: (i) => (
        <span title={i.fuente_precio ? FUENTE_PRECIO_LABEL[i.fuente_precio] ?? i.fuente_precio : undefined}>
          {i.precio_ref ? formatCOP(i.precio_ref) : <span className="text-orange-500">sin precio</span>}
        </span>
      ),
    },
    {
      id: 'fuente', header: 'Fuente del precio', prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'meta',
      valor: (i) => (i.fuente_precio ? FUENTE_PRECIO_LABEL[i.fuente_precio] ?? i.fuente_precio : 'Sin precio'),
    },
    {
      id: 'valor', header: 'Valor', valor: (i) => i.cantidad * (i.precio_ref ?? 0), align: 'right', tarjeta: 'meta',
      copiaTexto: (i) => String(i.cantidad * (i.precio_ref ?? 0)),
      celda: (i) => <>{i.precio_ref ? formatCOP(i.cantidad * i.precio_ref) : '—'}</>,
    },
    {
      id: 'origen_item', header: 'Lo pidió', valor: (i) => i.orden_insumo ?? 'Sin orden de insumo', prioridad: 3, tarjeta: 'meta',
      copiable: false,
      celda: (i) => (i.orden_insumo && i.orden_insumo_id
        ? <Link href={`/ordenes-insumo/${i.orden_insumo_id}`} className="font-mono text-xs text-brand-green hover:underline">{i.orden_insumo}</Link>
        : <span className="text-gray-300">—</span>),
    },
    {
      id: 'oc', header: 'Orden de compra', valor: (i) => i.oc ?? 'Pendiente', tarjeta: 'meta', copiable: false,
      celda: (i) => (i.oc && i.oc_id
        ? <Link href={`/ordenes-compra/${i.oc_id}`} className="font-mono text-xs text-brand-green hover:underline">{i.oc}</Link>
        : <span className="text-gray-300">pendiente</span>),
    },
    {
      id: 'justificacion', header: 'Justificación', valor: (i) => i.justificacion ?? '',
      prioridad: 3, className: 'text-xs text-gray-500', ancho: 'min-w-[200px]', tarjeta: 'cuerpo',
    },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h2 className="font-heading text-sm font-semibold text-gray-900">Qué se pide</h2>
        <span className="ml-auto font-body text-xs text-gray-400">
          {items.length} producto(s)
          {sinPrecio > 0 && <> · {sinPrecio} sin precio de referencia</>}
        </span>
      </div>
      <div className="p-4">
        <TablaEstandar
          id="solicitud-compra-items"
          titulo="Ítems de la solicitud de compra"
          modulo="Compras"
          entidad="solicitud_compra_items"
          datos={items}
          columnas={columnas}
          filaId={(i) => i.id}
          busqueda="Buscar producto…"
          itemDescarga={(i) => i.codigo}
          pie={(filas) => ({
            producto: <span className="font-semibold">{filas.length} producto(s)</span>,
            cantidad: <span className="font-bold">{miles(filas.reduce((a, f) => a + f.cantidad, 0))}</span>,
            valor: <span className="font-bold">{formatCOP(filas.reduce((a, f) => a + f.cantidad * (f.precio_ref ?? 0), 0))}</span>,
          })}
          vacio={<p className="font-body text-sm text-gray-400">La solicitud no tiene productos.</p>}
        />
      </div>
    </div>
  )
}
