import { getRutas, getConductores } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import { createClient } from '@/lib/supabase/server'
import ControlRutasClient from './ControlRutasClient'

export const metadata = { title: 'Control de Rutas | Logística' }

export default async function ControlRutasPage() {
  await requirePermiso('gestionar_rutas')
  const hoy = new Date().toISOString().split('T')[0]

  const [rutas, conductores] = await Promise.all([
    getRutas(hoy).catch(() => []),
    getConductores().catch(() => []),
  ])

  const supabase = await createClient()
  const { data: ordenesDisponibles } = await supabase
    .from('ordenes_insumo')
    .select('id, numero, estado, sede:sedes(id, nombre, ciudad), conductor_id')
    .eq('estado', 'DESPACHADO')
    .is('conductor_id', null)
    .order('created_at', { ascending: false })

  return (
    <ControlRutasClient
      rutasIniciales={rutas}
      conductoresDisponibles={conductores}
      ordenesDisponibles={ordenesDisponibles ?? []}
      fechaHoy={hoy}
    />
  )
}
