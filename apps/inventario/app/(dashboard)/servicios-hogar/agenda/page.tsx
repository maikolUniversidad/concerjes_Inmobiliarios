import { requirePermiso } from '@/lib/permisos-server'
import { getAgenda } from '../actions'
import AgendaClient from './AgendaClient'

function getLunesISO(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>
}) {
  await requirePermiso('gestionar_agenda_hogar')
  const sp = await searchParams
  const semanaInicio = sp.semana ?? getLunesISO()

  const agenda = await getAgenda(semanaInicio).catch(() => [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agenda de Servicios</h1>
        <p className="text-gray-500 text-sm mt-1">Calendario semanal con todos los servicios programados</p>
      </div>
      <AgendaClient agenda={agenda} semanaInicio={semanaInicio} />
    </div>
  )
}
