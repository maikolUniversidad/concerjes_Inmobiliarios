import { getHorariosSede } from '../actions'
import { requirePermiso } from '@/lib/permisos-server'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import HorariosClient from './HorariosClient'

export const metadata = { title: 'Horarios de Entrega | Logística' }

export default async function HorariosPage() {
  await requirePermiso('gestionar_horarios_entrega')
  const supabase = await createClient()

  const [horarios, { data: sedes }] = await Promise.all([
    getHorariosSede(),
    traerTodo((desde, hasta) => supabase.from('sedes').select('id, nombre, ciudad, zona').eq('activo', true).order('nombre').order('id').range(desde, hasta)).then((data) => ({ data })),
  ])

  return <HorariosClient horariosIniciales={horarios} sedesDisponibles={sedes ?? []} />
}
