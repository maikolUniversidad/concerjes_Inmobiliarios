import { requirePermiso } from '@/lib/permisos-server'
import { getUbicacionesConductores, getRutas } from '../actions'
import MapaLiveClient from './MapaLiveClient'

export const metadata = { title: 'Mapa en Vivo | Logística' }

export default async function MapaPage() {
  await requirePermiso('ver_ubicacion_conductores')
  const hoy = new Date().toISOString().split('T')[0]
  const [ubicaciones, rutas] = await Promise.all([
    getUbicacionesConductores(),
    getRutas(hoy),
  ])
  return <MapaLiveClient ubicacionesIniciales={ubicaciones} rutasHoy={rutas} />
}
