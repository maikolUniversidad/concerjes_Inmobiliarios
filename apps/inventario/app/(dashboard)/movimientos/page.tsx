import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Settings2, ArrowLeftRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type { TipoMovimiento } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Movimientos' }
export const revalidate = 10

const TIPO_META: Record<TipoMovimiento, { label: string; cls: string; icon: typeof ArrowDownToLine }> = {
  ENTRADA: { label: 'Entrada', cls: 'bg-green-100 text-green-700', icon: ArrowDownToLine },
  SALIDA: { label: 'Salida', cls: 'bg-orange-100 text-orange-700', icon: ArrowUpFromLine },
  DEVOLUCION: { label: 'Devolución', cls: 'bg-blue-100 text-blue-700', icon: RefreshCw },
  AJUSTE: { label: 'Ajuste', cls: 'bg-purple-100 text-purple-700', icon: Settings2 },
  TRASLADO: { label: 'Traslado', cls: 'bg-gray-100 text-gray-600', icon: ArrowLeftRight },
}

interface MovRow {
  id: string
  tipo: TipoMovimiento
  cantidad: number
  observacion: string | null
  created_at: string
  producto: { nombre_estandar: string; presentacion: string | null } | null
}

export default async function MovimientosPage() {
  await requirePermiso('ver_movimientos')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('movimientos')
    .select('id, tipo, cantidad, observacion, created_at, producto:productos ( nombre_estandar, presentacion )')
    .order('created_at', { ascending: false })
    .limit(100)

  const movs = (data as unknown as MovRow[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Movimientos</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Trazabilidad de entradas, salidas, ajustes y traslados
          </p>
        </div>
        <Link href="/movimientos/nuevo"
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Registrar movimiento
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando movimientos: {error.message}
        </div>
      )}

      {movs.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <ArrowLeftRight className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay movimientos</p>
          <p className="font-body text-sm mt-1">Registra el primer movimiento para empezar la trazabilidad.</p>
          <Link href="/movimientos/nuevo" className="inline-block mt-4 text-brand-green font-body font-semibold text-sm hover:underline">
            Registrar movimiento →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Tipo</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Producto</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Cantidad</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Observación</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movs.map(m => {
                  const meta = TIPO_META[m.tipo]
                  const Icon = meta.icon
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-body font-medium text-xs px-2.5 py-1 rounded-full ${meta.cls}`}>
                          <Icon className="w-3.5 h-3.5" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-body font-medium text-sm text-gray-900">{m.producto?.nombre_estandar ?? '—'}</p>
                        <p className="font-body text-xs text-gray-400">{m.producto?.presentacion}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-heading font-bold text-base text-gray-900">{m.cantidad}</td>
                      <td className="px-4 py-3 font-body text-sm text-gray-500 max-w-[260px] truncate">{m.observacion ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-body text-xs text-gray-400">
                        {new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
