import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { PostulacionesClient } from './PostulacionesClient'

export const metadata: Metadata = { title: 'Postulaciones · Gestión Humana' }
export const dynamic = 'force-dynamic'

export default async function PostulacionesPage() {
  await requirePermiso('ver_postulaciones')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const [
    { data: candidatos }, { data: postulaciones }, { data: docsMini },
    { data: eps }, { data: cargos }, { data: municipios }, { data: vacantes }, { data: tipos },
    { data: roles },
  ] = await Promise.all([
    sb.from('candidatos').select('*').neq('estado', 'BORRADOR').order('updated_at', { ascending: false }),
    sb.from('postulaciones').select('id, candidato_id, vacante_id, estado, created_at'),
    sb.from('candidato_documentos').select('id, candidato_id, estado'),
    sb.from('eps').select('id, nombre'),
    sb.from('cargos').select('id, nombre'),
    sb.from('municipios').select('codigo_dane, nombre'),
    sb.from('vacantes').select(`
      id, slug, cupos, cupos_ocupados, abierta,
      cargo:cargos ( nombre ),
      obra:obras ( codigo_contrato_servicio, cliente:empresas_usuarias ( nombre ) )
    `),
    sb.from('vac_tipos_documentales').select('id, codigo, nombre, grupo, obligatorio, min_archivos, max_archivos, ola').order('orden'),
    sb.from('roles').select('id, nombre, rol_base').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Postulaciones</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Candidatos del Registro de Vacantes · {(candidatos ?? []).length} en proceso
        </p>
      </div>

      <PostulacionesClient
        candidatos={candidatos ?? []}
        postulaciones={postulaciones ?? []}
        docsMini={docsMini ?? []}
        eps={eps ?? []}
        cargos={cargos ?? []}
        municipios={municipios ?? []}
        vacantes={vacantes ?? []}
        tipos={tipos ?? []}
        roles={roles ?? []}
      />
    </div>
  )
}
