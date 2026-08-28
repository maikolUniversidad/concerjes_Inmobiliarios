import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type {
  EventoNotificacion, FlujoEjecucion, FlujoEjecucionPaso, FlujoNotificacion, FlujoPaso, PlantillaCorreo,
} from '@/lib/types/database'
import { FlujoEditor } from './FlujoEditor'

export const metadata: Metadata = { title: 'Flujo de notificación' }
export const revalidate = 0

export default async function FlujoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const permisos = await requirePermiso('ver_flujos_notificacion')
  const supabase = await createClient()

  const { data: flujo } = await supabase
    .from('flujos_notificacion').select('*').eq('id', id).maybeSingle()
  if (!flujo) notFound()

  const f = flujo as FlujoNotificacion

  const [{ data: evento }, { data: pasos }, { data: plantillas }, { data: usuarios }, { data: ejecuciones }] =
    await Promise.all([
      supabase.from('eventos_notificacion').select('*').eq('codigo', f.evento_codigo).maybeSingle(),
      supabase.from('flujo_pasos').select('*').eq('flujo_id', id).order('orden', { ascending: true }),
      supabase.from('plantillas_correo').select('id, codigo, nombre, asunto, activa').eq('activa', true).order('nombre'),
      supabase.from('usuarios').select('id, nombre, email, rol').eq('activo', true).order('nombre'),
      supabase.from('flujo_ejecuciones').select('*').eq('flujo_id', id)
        .order('created_at', { ascending: false }).limit(15),
    ])

  const idsEjecucion = ((ejecuciones ?? []) as FlujoEjecucion[]).map((e) => e.id)
  const { data: pasosEjecucion } = idsEjecucion.length
    ? await supabase.from('flujo_ejecucion_pasos').select('*')
        .in('ejecucion_id', idsEjecucion).order('orden', { ascending: true })
    : { data: [] }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <Link href="/notificaciones/flujos" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Eventos y flujos
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">{f.nombre}</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {f.descripcion || 'Pasos que se ejecutan cuando ocurre el evento.'}
        </p>
      </div>

      <FlujoEditor
        flujo={f}
        evento={(evento as EventoNotificacion | null) ?? null}
        pasos={(pasos as FlujoPaso[]) ?? []}
        plantillas={(plantillas as Pick<PlantillaCorreo, 'id' | 'codigo' | 'nombre' | 'asunto' | 'activa'>[]) ?? []}
        usuarios={(usuarios as { id: string; nombre: string; email: string | null; rol: string }[]) ?? []}
        ejecuciones={(ejecuciones as FlujoEjecucion[]) ?? []}
        pasosEjecucion={(pasosEjecucion as FlujoEjecucionPaso[]) ?? []}
        puedeGestionar={permisos.puede('gestionar_flujos_notificacion')}
      />
    </div>
  )
}
