import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ListTree } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type { EventoNotificacion, FlujoNotificacion } from '@/lib/types/database'
import { EventosClient } from './EventosClient'

export const metadata: Metadata = { title: 'Catálogo de eventos' }
export const revalidate = 0

export default async function EventosPage() {
  const permisos = await requirePermiso('ver_flujos_notificacion')
  const supabase = await createClient()

  const [{ data: eventos }, { data: flujos }] = await Promise.all([
    supabase.from('eventos_notificacion').select('*').order('modulo').order('nombre'),
    supabase.from('flujos_notificacion').select('id, nombre, evento_codigo, activo'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <Link href="/notificaciones/flujos" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Eventos y flujos
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <ListTree className="w-6 h-6 text-brand-green" /> Catálogo de eventos
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Todo lo que puede disparar una notificación, con la descripción de cuándo ocurre y los datos que
          entrega. Sobre estos eventos se arman los flujos.
        </p>
      </div>

      <EventosClient
        eventos={(eventos as EventoNotificacion[]) ?? []}
        flujos={(flujos as Pick<FlujoNotificacion, 'id' | 'nombre' | 'evento_codigo' | 'activo'>[]) ?? []}
        puedeGestionar={permisos.puede('gestionar_flujos_notificacion')}
      />
    </div>
  )
}
