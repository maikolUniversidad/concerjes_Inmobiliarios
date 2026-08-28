'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Ban, FileText, Printer } from 'lucide-react'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import type { EstadoOC } from '@/lib/types/database'

export interface OCRow {
  id: string
  numero_oc: string
  estado: EstadoOC
  periodo: string
  fecha_emision: string
  valor_total: number | null
  proveedor: { nombre: string } | null
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

const ESTADO_CLS: Record<string, string> = {
  BORRADOR: 'bg-gray-100 text-gray-600',
  APROBADA: 'bg-indigo-100 text-indigo-700',
  ENVIADA: 'bg-blue-100 text-blue-700',
  PARCIAL: 'bg-amber-100 text-amber-700',
  COMPLETA: 'bg-green-100 text-green-700',
  ANULADA: 'bg-red-100 text-red-700',
}
const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador', APROBADA: 'Aprobada', ENVIADA: 'Comprada',
  PARCIAL: 'Recepción parcial', COMPLETA: 'Recibida', ANULADA: 'Anulada',
}

export function OrdenesCompraTabla({
  ordenes,
  anularOC,
}: {
  ordenes: OCRow[]
  /** Server action de anulación; llega desde el componente de servidor. */
  anularOC: (formData: FormData) => void | Promise<void>
}) {
  const router = useRouter()
  const columnas: ColumnaTabla<OCRow>[] = [
    {
      id: 'numero', header: 'N° OC', valor: o => o.numero_oc, ancho: 'w-32', tarjeta: 'titulo',
      celda: o => (
        <Link href={`/ordenes-compra/${o.id}`} className="font-mono text-sm text-brand-green hover:underline">
          {o.numero_oc}
        </Link>
      ),
    },
    { id: 'proveedor', header: 'Proveedor', valor: o => o.proveedor?.nombre ?? '', className: 'text-gray-700', ancho: 'min-w-[200px]', tarjeta: 'subtitulo' },
    {
      id: 'emision', header: 'Emisión', prioridad: 2, className: 'text-xs text-gray-500', tarjeta: 'meta',
      valor: o => new Date(o.fecha_emision).toLocaleDateString('es-CO'),
    },
    { id: 'periodo', header: 'Periodo', valor: o => o.periodo, prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'meta' },
    {
      id: 'valor', header: 'Valor', valor: o => o.valor_total ?? 0, align: 'right', tarjeta: 'meta',
      copiaTexto: o => (o.valor_total != null ? String(o.valor_total) : ''),
      celda: o => (
        <span className="font-heading font-semibold text-sm text-gray-900">
          {o.valor_total ? cop.format(o.valor_total) : '—'}
        </span>
      ),
    },
    {
      id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
      valor: o => ESTADO_LABEL[o.estado] ?? o.estado,
      celda: o => (
        <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${ESTADO_CLS[o.estado] ?? 'bg-gray-100 text-gray-600'}`}>
          {ESTADO_LABEL[o.estado] ?? o.estado}
        </span>
      ),
    },
  ]

  return (
    <TablaEstandar
      id="ordenes-compra"
      titulo="Órdenes de compra"
      modulo="Compras"
      entidad="ordenes_compra"
      datos={ordenes}
      columnas={columnas}
      filaId={o => o.id}
      busqueda="Buscar por N° OC, proveedor o estado…"
      onFilaClick={o => router.push(`/ordenes-compra/${o.id}`)}
      textoDetalle="Gestionar"
      anchoAcciones="w-44"
      acciones={o => (
        <>
          <Link href={`/ordenes-compra/${o.id}/imprimir`} target="_blank" title="Imprimir / Guardar PDF"
            className="p-2 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 transition-colors">
            <Printer className="w-3.5 h-3.5" />
          </Link>
          {o.estado !== 'ANULADA' && o.estado !== 'COMPLETA' && (
            <DeleteButton action={anularOC} id={o.id} mensaje={`¿Anular la orden ${o.numero_oc}?`}
              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Ban className="w-3.5 h-3.5" />
            </DeleteButton>
          )}
        </>
      )}
      vacio={
        <>
          <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay órdenes de compra</p>
          <p className="font-body text-sm mt-1 text-gray-400">
            Las OC se generan a partir del plan de aprovisionamiento.
          </p>
        </>
      }
    />
  )
}
