import { getPuntosEntrega } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import PuntosEntregaClient from './PuntosEntregaClient'

export const metadata = { title: 'Puntos de Entrega | Logística' }

export default async function PuntosEntregaPage() {
  await requirePermiso('ver_logistica')
  const sedes = await getPuntosEntrega().catch(() => [])
  return <PuntosEntregaClient sedesIniciales={sedes} />
}
