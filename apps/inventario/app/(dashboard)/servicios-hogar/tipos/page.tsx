import { requirePermiso } from '@/lib/permisos-server'
import { getTiposServicio } from '../actions'
import TiposClient from './TiposClient'

export default async function TiposPage() {
  await requirePermiso('gestionar_tipos_servicio')
  const tipos = await getTiposServicio().catch(() => [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tipos de Servicio</h1>
        <p className="text-gray-500 text-sm mt-1">Catálogo de servicios ofrecidos a los clientes</p>
      </div>
      <TiposClient tipos={tipos} />
    </div>
  )
}
