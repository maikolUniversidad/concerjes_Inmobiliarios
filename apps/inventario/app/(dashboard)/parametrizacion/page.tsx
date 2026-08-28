import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { ParametrizacionClient, type SedeOpt, type ProductoOpt, type ParamRow } from './ParametrizacionClient'

export const metadata: Metadata = { title: 'Parametrización por sede' }
export const dynamic = 'force-dynamic'

export default async function ParametrizacionPage() {
  await requirePermiso('ver_parametrizacion')
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  // Los tres conjuntos se necesitan COMPLETOS (la matriz de parametrización
  // cruza todas las sedes contra todos los productos): van paginados, porque
  // PostgREST corta en 1.000 filas y sede_productos ya pasa de 800.
  const [sedes, productos, params] = await Promise.all([
    traerTodo((desde, hasta) => supabase
      .from('sedes')
      .select('id, nombre, zona, codigo_interno, grupo:grupos_contrato ( codigo, nombre )')
      .eq('activo', true)
      .order('nombre').order('id')
      .range(desde, hasta)),
    traerTodo((desde, hasta) => supabase
      .from('productos')
      .select('id, ref, codigo, nombre_estandar, presentacion, tipo_insumo')
      .eq('activo', true)
      .order('nombre_estandar').order('id')
      .range(desde, hasta)),
    traerTodo((desde, hasta) => supabase
      .from('sede_productos')
      .select('id, sede_id, producto_id, cantidad_maxima, cantidad_minima, activo, observacion')
      .order('id')
      .range(desde, hasta)),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedesOpt: SedeOpt[] = ((sedes ?? []) as any[]).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    zona: s.zona ?? null,
    codigo_interno: s.codigo_interno ?? null,
    grupo_codigo: s.grupo?.codigo ?? null,
    grupo_nombre: s.grupo?.nombre ?? null,
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Parametrización por sede</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Define qué productos aplican en cada sede y su cantidad máxima. Base para el módulo de contratos.
        </p>
      </div>

      <ParametrizacionClient
        sedes={sedesOpt}
        productos={(productos ?? []) as unknown as ProductoOpt[]}
        params={(params ?? []) as unknown as ParamRow[]}
        puedeGestionar={perm.puede('gestionar_parametrizacion')}
      />
    </div>
  )
}
