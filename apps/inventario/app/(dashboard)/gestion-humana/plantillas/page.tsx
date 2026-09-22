import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { PlantillasClient } from './PlantillasClient'

export const metadata: Metadata = { title: 'Plantillas de documentos · Gestión Humana' }
export const dynamic = 'force-dynamic'

export default async function PlantillasPage() {
  await requirePermiso('ver_plantillas_documento')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const [{ data: plantillas }, { data: versiones }, { data: candidatos }, { data: cargos }] = await Promise.all([
    sb.from('plantillas_documento').select('*').order('momento').order('orden'),
    sb.from('plantilla_versiones').select('id, plantilla_id, version, notas, publicada, creado_por_nombre, created_at, sha256, variables').order('version', { ascending: false }),
    sb.from('vw_ats_bandeja').select('id, nombres, apellidos, numero_documento, estado').order('updated_at', { ascending: false }).limit(300),
    sb.from('cargos').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Plantillas de documentos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Formatos de selección y contratación digitalizados: se llenan solos con los datos del candidato y cada cambio queda como una versión nueva
        </p>
      </div>
      <PlantillasClient plantillas={plantillas ?? []} versiones={versiones ?? []} candidatos={candidatos ?? []} cargos={cargos ?? []} />
    </div>
  )
}
