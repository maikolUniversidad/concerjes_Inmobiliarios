import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, ArrowLeftRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import type { Categoria, Etiqueta } from '@/lib/clasificacion'
import { sedesPorClasificacion, leerFiltroClasif, cargarEtiquetas } from '@/lib/clasificacion-server'
import { FiltroClasificacion } from '@/components/clasificacion/FiltroClasificacion'
import { MovimientosClient, type MovRow } from './MovimientosClient'

export const metadata: Metadata = { title: 'Movimientos' }
export const dynamic = 'force-dynamic'

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermiso('ver_movimientos')
  const supabase = await createClient()
  const sp = await searchParams
  const perm = await getPermisosUsuario()

  const filtro = leerFiltroClasif(sp)
  const [sedeIds, { categorias, etiquetas }] = await Promise.all([
    sedesPorClasificacion(supabase, filtro),
    cargarEtiquetas(supabase),
  ])

  let query = supabase
    .from('movimientos')
    .select('id, tipo, cantidad, observacion, created_at, usuario_id, producto:productos ( nombre_estandar, presentacion ), sede:sedes ( nombre )')
    .order('created_at', { ascending: false })
    .limit(100)
  // Filtro por clasificación de contrato: sólo movimientos de esas sedes.
  if (sedeIds !== null) query = query.in('sede_id', sedeIds)

  const { data, error } = await query
  const movs = (data as unknown as MovRow[]) ?? []

  // Quién registró cada movimiento. Se resuelve por la vista `usuarios_opciones`
  // porque la RLS de `usuarios` no deja leer el nombre de otras personas.
  const idsUsuarios = [...new Set(movs.map(m => m.usuario_id).filter(Boolean))] as string[]
  if (idsUsuarios.length > 0) {
    const { data: usus } = await supabase.from('usuarios_opciones').select('id, nombre').in('id', idsUsuarios)
    const nombres = new Map(((usus ?? []) as { id: string; nombre: string }[]).map(u => [u.id, u.nombre]))
    for (const m of movs) m.responsable = m.usuario_id ? nombres.get(m.usuario_id) ?? null : null
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Movimientos</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Trazabilidad de entradas, salidas, ajustes y traslados
          </p>
        </div>
        <Link href="/movimientos/nuevo"
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Registrar movimiento
        </Link>
      </div>

      <Suspense fallback={null}>
        <FiltroClasificacion categorias={categorias as Categoria[]} etiquetas={etiquetas as Etiqueta[]} />
      </Suspense>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando movimientos: {error.message}
        </div>
      )}

      {movs.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <ArrowLeftRight className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay movimientos</p>
          <p className="font-body text-sm mt-1">Registra el primer movimiento para empezar la trazabilidad.</p>
          <Link href="/movimientos/nuevo" className="inline-block mt-4 text-brand-green font-body font-semibold text-sm hover:underline">
            Registrar movimiento →
          </Link>
        </div>
      ) : (
        <MovimientosClient movs={movs} puedeEliminar={perm.puede('eliminar_movimientos')} />
      )}
    </div>
  )
}
