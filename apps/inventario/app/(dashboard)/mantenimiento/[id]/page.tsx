import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import type { MantenimientoMensaje } from '@/lib/types/database'
import { TicketClient, type TicketDetalle, type MaterialFila } from './TicketClient'

export const metadata: Metadata = { title: 'Ticket de mantenimiento' }
export const dynamic = 'force-dynamic'

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermisosUsuario()
  const flags = {
    ver: perm.puede('ver_mantenimiento'),
    reportar: perm.puede('reportar_falla_maquinaria'),
    tecnico: perm.puede('atender_mantenimiento') || perm.puede('gestionar_mantenimiento'),
    jefe: perm.puede('gestionar_mantenimiento'),
  }
  if (!flags.ver && !flags.reportar && !flags.tecnico) redirect('/dashboard')

  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  // Un ticket trae equipo propio O activo del cliente, nunca los dos: el
  // `select` pide los dos y uno de los dos vuelve nulo.
  const { data: ticket } = await sb.from('mantenimiento_tickets')
    .select(`*,
      maquinaria:maquinaria_id(id, codigo, nombre, estado, condicion, imagen_url, ubicacion_texto),
      activo:activo_id(id, codigo, nombre, estado, criticidad, ubicacion_texto, piso, punto_id, fotos,
                       tipo:activo_tipo_id(nombre, normativa)),
      plan:plan_id(id, codigo, nombre, frecuencia_tipo, frecuencia_valor, obligatorio_normativo, normativa),
      proveedor:proveedor_id(id, nombre),
      sede:sede_id(id, nombre)`)
    .eq('id', id).maybeSingle()
  if (!ticket) notFound()

  const [{ data: mensajes }, { data: tecnicos }, { data: materiales }] = await Promise.all([
    sb.from('mantenimiento_mensajes')
      .select('id, ticket_id, usuario_id, usuario_nombre, tipo, mensaje, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes, created_at')
      .eq('ticket_id', id).order('created_at').limit(1000),
    flags.jefe || flags.tecnico ? sb.rpc('mant_tecnicos') : Promise.resolve({ data: [] }),
    sb.from('mant_materiales')
      .select('id, producto_id, producto_nombre, cantidad, costo_unitario, costo_total, movimiento_id, usuario_nombre, created_at')
      .eq('ticket_id', id).order('created_at'),
  ])

  const volverA = ticket.maquinaria_id ? `/equipo/${ticket.maquinaria_id}` : '/rondas/activos'

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <Link href={flags.ver ? '/mantenimiento' : volverA}
        className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm">
        <ArrowLeft className="w-4 h-4" /> {flags.ver ? 'Tablero de mantenimiento' : ticket.maquinaria_id ? 'Volver al equipo' : 'Volver a los activos'}
      </Link>
      <TicketClient
        ticket={ticket as TicketDetalle}
        mensajes={(mensajes ?? []) as MantenimientoMensaje[]}
        tecnicos={(tecnicos ?? []) as { id: string; nombre: string; rol_nombre: string | null }[]}
        materiales={(materiales ?? []) as MaterialFila[]}
        usuarioId={user?.id ?? ''}
        permisos={flags}
      />
    </div>
  )
}
