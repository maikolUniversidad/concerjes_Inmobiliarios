import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { SELECT_MENSAJE, type SoporteMensaje, type SoporteTicket } from '@/lib/soporte'
import { TicketSoporteClient } from './TicketSoporteClient'

export const metadata: Metadata = { title: 'Ticket de soporte' }
export const dynamic = 'force-dynamic'

export default async function TicketSoportePage({ params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermisosUsuario()
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  // La RLS decide: quien reportó o quien tiene permiso de soporte.
  const { data: ticket } = await sb.from('soporte_tickets').select('*').eq('id', id).maybeSingle()
  if (!ticket) notFound()

  const agente = perm.puede('gestionar_soporte')
  const [{ data: mensajes }, { data: agentes }] = await Promise.all([
    sb.from('soporte_mensajes').select(SELECT_MENSAJE).eq('ticket_id', id).order('created_at').order('id').limit(2000),
    agente ? sb.rpc('soporte_agentes') : Promise.resolve({ data: [] }),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/soporte" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm">
        <ArrowLeft className="w-4 h-4" /> Tickets de soporte
      </Link>
      <TicketSoporteClient
        ticket={ticket as SoporteTicket}
        mensajes={(mensajes ?? []) as SoporteMensaje[]}
        agentes={(agentes ?? []) as { id: string; nombre: string; rol_nombre: string | null }[]}
        usuarioId={user?.id ?? ''}
        agente={agente}
      />
    </div>
  )
}
