import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, Workflow } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type { EventoNotificacion, FlujoNotificacion } from '@/lib/types/database'
import { FlujosClient } from './FlujosClient'

export const metadata: Metadata = { title: 'Flujos de notificación' }
export const revalidate = 0

export default async function FlujosPage() {
  const permisos = await requirePermiso('ver_flujos_notificacion')
  const supabase = await createClient()

  const [{ data: flujos }, { data: eventos }, { data: pasos }] = await Promise.all([
    supabase.from('flujos_notificacion').select('*').order('nombre', { ascending: true }),
    supabase.from('eventos_notificacion').select('*').order('modulo').order('nombre'),
    supabase.from('flujo_pasos').select('flujo_id, tipo'),
  ])

  // Resumen de pasos por flujo para la tarjeta del listado.
  const conteo = new Map<string, number>()
  for (const p of (pasos ?? []) as { flujo_id: string }[]) {
    conteo.set(p.flujo_id, (conteo.get(p.flujo_id) ?? 0) + 1)
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <Link href="/notificaciones" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Notificaciones
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <Workflow className="w-6 h-6 text-brand-green" /> Eventos y flujos
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Cuando ocurre un evento y se cumplen las condiciones, el flujo ejecuta sus pasos en orden:
          avisar por correo, notificar en la app, esperar y volver a revisar si la situación sigue igual.
        </p>
      </div>

      <FlujosClient
        flujos={(flujos as FlujoNotificacion[]) ?? []}
        eventos={(eventos as EventoNotificacion[]) ?? []}
        pasosPorFlujo={Object.fromEntries(conteo)}
        puedeGestionar={permisos.puede('gestionar_flujos_notificacion')}
      />
    </div>
  )
}
