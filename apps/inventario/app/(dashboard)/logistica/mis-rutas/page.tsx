import { getRutaConductor } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import MisRutasClient from './MisRutasClient'

export const metadata = { title: 'Mis Rutas | Logística' }

export default async function MisRutasPage() {
  await requirePermiso('ver_rutas_conductor')
  const ruta = await getRutaConductor()
  return <MisRutasClient rutaInicial={ruta} />
}
