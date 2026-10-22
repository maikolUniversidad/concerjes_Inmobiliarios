import type { Metadata } from 'next'
import { CalendarClock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { AsignacionesClient, type AsignacionFila, type PuntoOpcion } from './AsignacionesClient'

export const metadata: Metadata = { title: 'Asignaciones de tareas' }
export const dynamic = 'force-dynamic'

export default async function AsignacionesPage() {
  await requirePermiso('ver_asignaciones_rondas')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [asignaciones, plantillas, contratos, sedes, roles, cargos] = await Promise.all([
    traerTodo<AsignacionFila>((desde, hasta) => sb.from('ronda_asignaciones')
      .select(`id, grupo_id, sede_id, punto_id, plantilla_codigo, frecuencia, cada_horas,
               veces_por_periodo, dias, ventana_desde, ventana_hasta, tolerancia_min, evento,
               rol_id, cargo_id, persona_id, prioridad, sla_min, vigente_desde, vigente_hasta,
               activo, observacion,
               contrato:grupos_contrato ( codigo, nombre ),
               sede:sedes ( nombre ),
               rol:roles ( nombre ),
               cargo:cargos ( nombre )`)
      .order('sede_id').order('punto_id').order('plantilla_codigo').order('id').range(desde, hasta),
      { etiqueta: 'asignaciones' }),
    traerTodo<{ codigo: string; nombre: string; grupo_id: string | null }>((desde, hasta) =>
      sb.from('ronda_plantillas').select('codigo, nombre, grupo_id').eq('estado', 'PUBLICADA')
        .order('codigo').order('grupo_id').range(desde, hasta), { etiqueta: 'plantillas publicadas' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('grupos_contrato').select('id, codigo, nombre')
        .order('codigo').order('id').range(desde, hasta), { etiqueta: 'contratos' }),
    traerTodo<{ id: string; nombre: string; grupo_id: string | null }>((desde, hasta) =>
      sb.from('sedes').select('id, nombre, grupo_id')
        .order('nombre').order('id').range(desde, hasta), { etiqueta: 'sedes' }),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      sb.from('roles').select('id, nombre').order('nombre').order('id').range(desde, hasta),
      { etiqueta: 'roles' }),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      sb.from('cargos').select('id, nombre').eq('activo', true)
        .order('nombre').order('id').range(desde, hasta), { etiqueta: 'cargos' }),
  ])

  // Los puntos de control son de F2 y viven en otra rama: mientras su migración
  // no esté aplicada, la consulta falla y aquí se resuelve con un `null`, que es
  // lo que hace que la pantalla pida el identificador del punto a mano en vez
  // de romperse. Cuando F2 entre, el desplegable aparece solo.
  let puntos: PuntoOpcion[] | null = null
  try {
    const { data, error } = await sb.from('ronda_puntos')
      .select('id, codigo, nombre, sede_id, grupo_id').order('codigo').limit(1000)
    if (!error) puntos = (data ?? []) as PuntoOpcion[]
  } catch {
    puntos = null
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <CalendarClock className="w-6 h-6 text-brand-green" /> Asignaciones de tareas
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {asignaciones.length} asignaciones · qué tarea aplica en qué punto, cada cuánto, en qué
          horario y quién responde. La asignación apunta al código de la plantilla, así que publicar
          una versión nueva no obliga a tocarlas.
        </p>
      </div>

      <AsignacionesClient
        asignaciones={asignaciones}
        plantillas={plantillas}
        contratos={contratos}
        sedes={sedes}
        roles={roles}
        cargos={cargos}
        puntos={puntos}
        puedeGestionar={permisos.puede('gestionar_asignaciones_rondas')}
      />
    </div>
  )
}
