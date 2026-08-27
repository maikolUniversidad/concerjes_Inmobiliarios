import { requirePermiso } from '@/lib/permisos-server'
import {
  getCobros, getResumenPagos, getPagosPorVerificar, getSolicitudesSinCobro, getMetodosPago,
} from '../pagos-actions'
import PagosClient from './PagosClient'

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; search?: string; page?: string }>
}) {
  await requirePermiso('gestionar_pagos_hogar')
  const sp = await searchParams
  const page = parseInt(sp.page ?? '1', 10)
  const pageSize = 20

  const [{ cobros, total }, resumen, porVerificar, facturables, metodos] = await Promise.all([
    getCobros({ estado: sp.estado, search: sp.search, page }).catch(() => ({ cobros: [], total: 0 })),
    getResumenPagos().catch(() => ({ porCobrar: 0, saldoPendiente: 0, vencidos: 0, porVerificar: 0, recaudado: 0 })),
    getPagosPorVerificar().catch(() => []),
    getSolicitudesSinCobro().catch(() => []),
    getMetodosPago().catch(() => []),
  ])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pagos y Cuentas de Cobro</h1>
        <p className="text-gray-500 text-sm mt-1">
          Genera cuentas de cobro, verifica los pagos reportados por los clientes y controla la cartera
        </p>
      </div>
      <PagosClient
        cobros={cobros}
        total={total}
        page={page}
        pageSize={pageSize}
        estado={sp.estado ?? 'TODOS'}
        search={sp.search ?? ''}
        resumen={resumen}
        porVerificar={porVerificar}
        facturables={facturables}
        metodos={metodos}
      />
    </div>
  )
}
