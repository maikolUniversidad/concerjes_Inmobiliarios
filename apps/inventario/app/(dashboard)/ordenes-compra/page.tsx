import type { Metadata } from 'next'
import { FileText, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { EstadoOC } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Órdenes de Compra' }
export const revalidate = 30

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

const ESTADO_CLS: Record<EstadoOC, string> = {
  BORRADOR: 'bg-gray-100 text-gray-600',
  ENVIADA: 'bg-blue-100 text-blue-700',
  PARCIAL: 'bg-amber-100 text-amber-700',
  COMPLETA: 'bg-green-100 text-green-700',
  ANULADA: 'bg-red-100 text-red-700',
}

interface OCRow {
  id: string
  numero_oc: string
  estado: EstadoOC
  periodo: string
  fecha_emision: string
  valor_total: number | null
  proveedor: { nombre: string } | null
}

export default async function OrdenesCompraPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ordenes_compra')
    .select('id, numero_oc, estado, periodo, fecha_emision, valor_total, proveedor:proveedores ( nombre )')
    .order('fecha_emision', { ascending: false })
    .limit(100)

  const ordenes = (data as unknown as OCRow[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Órdenes de Compra</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">{ordenes.length} órdenes registradas</p>
        </div>
        <button className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg opacity-60 cursor-not-allowed" title="Creación de OC — próximamente">
          <Plus className="w-4 h-4" /> Nueva orden
        </button>
      </div>

      {ordenes.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay órdenes de compra</p>
          <p className="font-body text-sm mt-1">
            Las OC se generan a partir del plan de aprovisionamiento.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">N° OC</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Proveedor</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Emisión</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Valor</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ordenes.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-sm text-gray-900">{o.numero_oc}</td>
                    <td className="px-4 py-3 font-body text-sm text-gray-700">{o.proveedor?.nombre ?? '—'}</td>
                    <td className="px-4 py-3 font-body text-xs text-gray-500">{new Date(o.fecha_emision).toLocaleDateString('es-CO')}</td>
                    <td className="px-4 py-3 text-right font-heading font-semibold text-sm text-gray-900">{o.valor_total ? cop.format(o.valor_total) : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${ESTADO_CLS[o.estado]}`}>{o.estado}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
