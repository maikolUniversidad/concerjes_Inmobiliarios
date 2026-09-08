import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { PlantaClient, type PlantaRow } from './PlantaClient'

export const metadata: Metadata = { title: 'Planta de personal · Gestión Humana' }
export const dynamic = 'force-dynamic'

const SELECT =
  'id, documento, nombre_completo, nombres, apellidos, cargo, estado, ciudad, departamento, ' +
  'centro_costo, es_disponibilidad, es_administrativo, telefono, salario, fecha_ingreso, ' +
  'fecha_retiro, tiene_cuenta, usuario_email, usuario_rol, veces_vinculado, ' +
  'tiene_vinculacion_activa, candidato_id, nombre_confianza'

export default async function PlantaPage() {
  await requirePermiso('ver_planta_personal')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const [filas, { data: resumen }, incidencias] = await Promise.all([
    // Paginado: PostgREST corta en 1.000 filas sin avisar y la planta son 6.639.
    traerTodo<PlantaRow>((desde, hasta) => sb
      .from('vw_planta_personal')
      .select(SELECT)
      .order('apellidos', { ascending: true })
      .order('documento', { ascending: true })
      .range(desde, hasta),
      { etiqueta: 'planta de personal' }),
    sb.rpc('planta_resumen'),
    traerTodo<{ motivo: string }>((desde, hasta) => sb
      .from('vw_planta_inconsistencias').select('motivo').order('documento').range(desde, hasta)),
  ])

  const porMotivo = incidencias.reduce((a: Record<string, number>, i) => {
    a[i.motivo] = (a[i.motivo] ?? 0) + 1
    return a
  }, {})

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Planta de personal</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Maestro de colaboradores desde nómina · activos, retirados e historial de vinculaciones
        </p>
      </div>

      <PlantaClient
        filas={filas}
        resumen={(resumen?.[0] ?? null) as Record<string, number> | null}
        incidencias={porMotivo}
      />
    </div>
  )
}
