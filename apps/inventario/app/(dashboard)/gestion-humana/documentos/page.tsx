import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { DocumentosClient } from './DocumentosClient'
import type { TipoDoc } from './tipos'
import type { PersonaLite } from './DocumentosClient'

export const metadata: Metadata = { title: 'Documentos · Gestión Humana' }
export const dynamic = 'force-dynamic'

export default async function DocumentosGHPage({
  searchParams,
}: {
  searchParams: Promise<{ persona?: string }>
}) {
  await requirePermiso('ver_documentos_rrhh')
  const { persona: initialPersonaId } = await searchParams
  const supabase = await createClient()

  const [{ data: tipos }, { data: personas }] = await Promise.all([
    supabase.from('tipos_documentales').select('id, parent_id, nombre, descripcion, orden').order('orden'),
    supabase.from('personas').select('id, nombres, apellidos, documento, tipo_doc').order('apellidos'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Documentos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Sube documentos por persona y organízalos con el árbol de tipos documentales
        </p>
      </div>

      <DocumentosClient
        tipos={(tipos ?? []) as TipoDoc[]}
        personas={(personas ?? []) as PersonaLite[]}
        initialPersonaId={initialPersonaId}
      />
    </div>
  )
}
