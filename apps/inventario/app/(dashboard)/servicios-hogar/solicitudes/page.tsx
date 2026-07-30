import { requirePermiso } from '@/lib/permisos-server'
import { getSolicitudes } from '../actions'
import SolicitudesClient from './SolicitudesClient'

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; search?: string; page?: string }>
}) {
  await requirePermiso('gestionar_solicitudes_hogar')
  const sp = await searchParams
  const page     = parseInt(sp.page ?? '1', 10)
  const pageSize = 20

  const { solicitudes, total } = await getSolicitudes({
    estado: sp.estado,
    search: sp.search,
    page,
  }).catch(() => ({ solicitudes: [], total: 0 }))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Solicitudes de Servicio</h1>
        <p className="text-gray-500 text-sm mt-1">Gestiona todas las solicitudes de los clientes</p>
      </div>
      <SolicitudesClient
        solicitudes={solicitudes}
        total={total}
        page={page}
        pageSize={pageSize}
      />
    </div>
  )
}
