import { getConductores } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import ConductoresClient from './ConductoresClient'

export const metadata = { title: 'Conductores | Logística' }

export default async function ConductoresPage() {
  await requirePermiso('gestionar_conductores')
  const conductores = await getConductores()
  return <ConductoresClient conductoresIniciales={conductores} />
}
