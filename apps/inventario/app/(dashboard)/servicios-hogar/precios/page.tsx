import { requirePermiso } from '@/lib/permisos-server'
import { getTarifas, getTiposServicio } from '../actions'
import PreciosClient from './PreciosClient'

export default async function PreciosPage() {
  await requirePermiso('gestionar_precios_servicio')

  const [tarifas, tipos] = await Promise.all([
    getTarifas().catch(() => []),
    getTiposServicio().catch(() => []),
  ])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Precios y Tarifas</h1>
        <p className="text-gray-500 text-sm mt-1">Gestiona los precios por tipo de servicio, duración y frecuencia</p>
      </div>
      <PreciosClient tarifas={tarifas} tipos={tipos} />
    </div>
  )
}
