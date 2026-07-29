import { getConductores, getUsuariosConductor } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import ConductoresClient from './ConductoresClient'

export const metadata = { title: 'Conductores | Logística' }

export default async function ConductoresPage() {
  await requirePermiso('gestionar_conductores')
  const [conductores, usuarios] = await Promise.all([
    getConductores(),
    getUsuariosConductor().catch(() => []),
  ])
  return <ConductoresClient conductoresIniciales={conductores} usuariosIniciales={usuarios} />
}
