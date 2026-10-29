import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, CalendarClock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { PlanesClient, type PlanFila, type ProximoFila, type Opciones } from './PlanesClient'

export const metadata: Metadata = { title: 'Planes preventivos' }
export const dynamic = 'force-dynamic'

export default async function PlanesPage() {
  await requirePermiso('ver_mantenimiento')
  const perm = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const SELECT = `id, codigo, nombre, descripcion, grupo_id, activo_tipo_id, activo_id, maquinaria_id,
    frecuencia_tipo, frecuencia_valor, medidor_id, anticipacion_dias, tolerancia_dias, vence_alerta_dias,
    obligatorio_normativo, normativa, tipo_ticket, prioridad, duracion_estimada_min,
    asignado_a, proveedor_id, activo, created_at,
    grupo:grupo_id(codigo, nombre),
    tipo:activo_tipo_id(nombre, normativa),
    objeto_activo:activo_id(codigo, nombre),
    objeto_maquinaria:maquinaria_id(codigo, nombre),
    proveedor:proveedor_id(nombre),
    tareas:mant_plan_tareas(id, orden, plantilla_id, plantilla_codigo, descripcion, plantilla:plantilla_id(codigo, nombre, version)),
    materiales:mant_plan_materiales(id, cantidad, producto_id, producto:producto_id(nombre_estandar, presentacion))`

  const [planes, proximos, grupos, tipos, plantillas, tecnicos, proveedores] = await Promise.all([
    traerTodo<PlanFila>((desde, hasta) => sb.from('mant_planes').select(SELECT)
      .order('activo', { ascending: false }).order('codigo').order('id').range(desde, hasta),
      { etiqueta: 'Planes' }),
    // Lo que le toca a cada objeto. La vista lo calcula en SQL: expandir los
    // planes por tipo en JavaScript sería traer todos los activos.
    traerTodo<ProximoFila>((desde, hasta) => sb.from('vw_mant_plan_proximos')
      .select('plan_id, plan_codigo, plan_nombre, objeto_codigo, objeto_nombre, activo_id, maquinaria_id, sede_id, frecuencia_tipo, proximo_el, proximo_medidor, medidor_actual, medidor_unidad, ultimo_at, ticket_abierto_id')
      .order('proximo_el', { ascending: true, nullsFirst: false }).order('plan_id').range(desde, hasta),
      { etiqueta: 'Próximos' }),
    sb.from('grupos_contrato').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    sb.from('activo_tipos').select('id, nombre, normativa, obligatorio_normativo, exige_medidor').order('nombre'),
    // Solo las tareas publicadas: una plantilla en borrador no se puede ejecutar.
    sb.from('ronda_plantillas').select('id, codigo, nombre, version, grupo_id')
      .eq('estado', 'PUBLICADA').order('codigo').order('version', { ascending: false }),
    perm.puede('gestionar_mantenimiento') ? sb.rpc('mant_tecnicos') : Promise.resolve({ data: [] }),
    sb.from('proveedores').select('id, nombre').eq('activo', true).order('nombre').limit(500),
  ])

  const opciones: Opciones = {
    grupos: (grupos?.data ?? []) as Opciones['grupos'],
    tipos: (tipos?.data ?? []) as Opciones['tipos'],
    plantillas: (plantillas?.data ?? []) as Opciones['plantillas'],
    tecnicos: (tecnicos?.data ?? []) as Opciones['tecnicos'],
    proveedores: (proveedores?.data ?? []) as Opciones['proveedores'],
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/mantenimiento" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm">
          <ArrowLeft className="w-4 h-4" /> Tablero de mantenimiento
        </Link>
        <h1 className="mt-1 font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <CalendarClock className="w-6 h-6 text-brand-green" /> Planes preventivos
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Cada cuánto le toca mantenimiento a cada activo o equipo, y qué tareas y materiales lleva ·
          las órdenes las programa el botón «Programar» del tablero
        </p>
      </div>
      <PlanesClient
        planes={planes}
        proximos={proximos}
        opciones={opciones}
        puedeGestionar={perm.puede('gestionar_mantenimiento')}
      />
    </div>
  )
}
