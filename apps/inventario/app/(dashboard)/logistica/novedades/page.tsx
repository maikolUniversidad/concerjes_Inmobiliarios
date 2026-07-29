import { getNovedades } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import NovedadesClient from './NovedadesClient'

export const metadata = { title: 'Novedades | Logística' }

export default async function NovedadesPage() {
  await requirePermiso('ver_novedades_entrega')
  const novedades = await getNovedades({ estado: 'ABIERTA' })
  return <NovedadesClient novedadesIniciales={novedades} />
}
