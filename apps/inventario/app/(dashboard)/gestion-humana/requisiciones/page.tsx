import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { RequisicionesClient } from './RequisicionesClient'

export const metadata: Metadata = { title: 'Requisiciones de personal · Gestión Humana' }
export const dynamic = 'force-dynamic'

export default async function RequisicionesPage() {
  await requirePermiso('ver_requisiciones')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const [
    { data: requisiciones }, { data: candidatos }, { data: cargos }, { data: centros }, { data: listas },
    { data: clientes }, { data: plantilla }, { data: empresa },
  ] = await Promise.all([
    sb.from('requisiciones').select('*').order('created_at', { ascending: false }),
    sb.from('candidatos').select('id, requisicion_id, estado, nombres, apellidos, numero_documento').not('requisicion_id', 'is', null),
    sb.from('cargos').select('id, nombre, tipo, requiere_manipulacion_alimentos, requiere_trabajo_alturas, requiere_examen_conduccion, funciones_generales').eq('activo', true).order('nombre'),
    sb.from('centros_costo').select('id, codigo, nombre, ciudad, cliente_id').eq('activo', true).order('codigo'),
    sb.from('vac_listas_opciones').select('lista, valor, etiqueta, orden').in('lista', ['TURNO', 'MOTIVO_REQUISICION', 'NIVEL_ACADEMICO', 'MODALIDAD_CONTRATO']).eq('activo', true).order('orden'),
    sb.from('empresas_usuarias').select('id, nombre').order('nombre'),
    sb.from('plantillas_documento').select('id, version_vigente, plantilla_versiones(version, cuerpo_html)').eq('codigo', 'REQUISICION_PERSONAL').maybeSingle(),
    sb.from('vac_empresa').select('*').eq('id', 1).maybeSingle(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cuerpo = (plantilla?.plantilla_versiones ?? []).find((v: any) => v.version === plantilla?.version_vigente)?.cuerpo_html ?? null

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Requisiciones de personal</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Solicitudes de vacantes por contrato y cargo (formato C_1.1 · versión 3) y los candidatos que las cubren
        </p>
      </div>
      <RequisicionesClient
        requisiciones={requisiciones ?? []}
        candidatos={candidatos ?? []}
        cargos={cargos ?? []}
        centros={centros ?? []}
        listas={listas ?? []}
        clientes={clientes ?? []}
        plantillaHtml={cuerpo}
        empresa={empresa ?? null}
      />
    </div>
  )
}
