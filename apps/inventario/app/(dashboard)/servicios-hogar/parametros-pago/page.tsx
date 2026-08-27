import { requirePermiso } from '@/lib/permisos-server'
import { getParametrosPago, getMetodosPago } from '../pagos-actions'
import ParametrosPagoClient from './ParametrosPagoClient'

export default async function ParametrosPagoPage() {
  await requirePermiso('parametrizar_pagos_hogar')

  const [parametros, metodos] = await Promise.all([
    getParametrosPago().catch(() => null),
    getMetodosPago().catch(() => []),
  ])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Parámetros de Pago</h1>
        <p className="text-gray-500 text-sm mt-1">
          Define cómo se cobra: impuestos, anticipos, plazos, formas de pago y los textos que ve el cliente en el portal
        </p>
      </div>
      <ParametrosPagoClient parametros={parametros} metodos={metodos} />
    </div>
  )
}
