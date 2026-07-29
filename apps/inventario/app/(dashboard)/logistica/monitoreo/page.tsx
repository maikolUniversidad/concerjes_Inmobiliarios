import { getMonitoreoEntregas, getUbicacionesConductores } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import MonitoreoClient from './MonitoreoClient'

export const metadata = { title: 'Tablero de Entregas | Logística' }

export default async function MonitoreoPage() {
  await requirePermiso('ver_monitoreo_entregas')
  const hoy = new Date().toISOString().split('T')[0]

  const [rutas, ubicaciones] = await Promise.all([
    getMonitoreoEntregas(hoy).catch(() => []),
    getUbicacionesConductores().catch(() => []),
  ])

  return (
    <MonitoreoClient
      rutasIniciales={rutas}
      ubicacionesIniciales={ubicaciones}
      fechaHoy={hoy}
    />
  )
}
