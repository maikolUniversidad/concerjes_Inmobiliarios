import { getRutaConductor } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import MisRutasClient from './MisRutasClient'

export const metadata = { title: 'Mis Rutas | Logística' }

export default async function MisRutasPage() {
  await requirePermiso('ver_rutas_conductor')
  let ruta = null
  try {
    ruta = await getRutaConductor()
  } catch {
    // Sin perfil de conductor o sin ruta asignada — MisRutasClient muestra estado vacío
  }
  return <MisRutasClient rutaInicial={ruta} />
}
