import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { SELECT_PQRS_BITACORA, type GestorPqrs, type Pqrs, type PqrsMensaje } from '@/lib/pqrs'
import { PqrsClient } from './PqrsClient'

export const metadata: Metadata = { title: 'PQRS' }
export const dynamic = 'force-dynamic'

const ROLES_COORDINACION = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']

export default async function PqrsDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const perm = await requirePermiso('ver_pqrs')
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  // La RLS decide: su sede, la que radicó o la que tiene a cargo.
  const { data: pqrs } = await sb.from('pqrs').select('*').eq('id', id).maybeSingle()
  if (!pqrs) notFound()

  const coordina = perm.puede('gestionar_pqrs') && ROLES_COORDINACION.includes(perm.rol)
  const [{ data: mensajes }, { data: gestores }] = await Promise.all([
    sb.from('pqrs_bitacora').select(SELECT_PQRS_BITACORA).eq('pqrs_id', id)
      .order('created_at').order('id').limit(2000),
    coordina ? sb.rpc('pqrs_gestores') : Promise.resolve({ data: [] }),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/pqrs" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> PQRS
      </Link>
      <PqrsClient
        pqrs={{ ...(pqrs as Pqrs), dias_plazo: Number((pqrs as Pqrs).dias_plazo) }}
        mensajes={(mensajes ?? []) as PqrsMensaje[]}
        gestores={(gestores ?? []) as GestorPqrs[]}
        usuarioId={user?.id ?? ''}
        coordina={coordina}
        puedeEscribir={perm.puede('gestionar_pqrs')}
      />
    </div>
  )
}
