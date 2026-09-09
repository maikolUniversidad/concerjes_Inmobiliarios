import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, ArrowLeftRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import type { Categoria, Etiqueta } from '@/lib/clasificacion'
import { CLAVE_TIPO_MOV, TIPO_MOV_META } from '@/lib/movimientos'
import { sedesPorClasificacion, leerFiltroClasif, cargarEtiquetas } from '@/lib/clasificacion-server'
import { FiltroClasificacion } from '@/components/clasificacion/FiltroClasificacion'
import { MovimientosClient, type MovRow } from './MovimientosClient'

export const metadata: Metadata = { title: 'Movimientos' }
export const dynamic = 'force-dynamic'

const COLUMNAS_MOV =
  'id, tipo, cantidad, observacion, created_at, usuario_id, producto:productos ( ref, codigo, nombre_estandar, presentacion ), sede:sedes ( nombre )'

/**
 * Tope de movimientos que se mandan al navegador.
 *
 * La tabla filtra, busca, ordena y exporta en cliente, así que todo lo que se
 * pinta tiene que estar cargado: con un tope bajo los chips por tipo y el Excel
 * salían contando sólo un pedazo del historial. El tope no desaparece —el
 * historial crece sin parar—, pero es alto y la pantalla avisa cuando corta, en
 * vez de mentir en silencio.
 */
const MAX_MOVIMIENTOS = 5_000

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

  /** Hay algún filtro puesto: cambia el mensaje de "sin datos". */
  const hayFiltro = sedeIds !== null

  // Paginado: PostgREST corta toda respuesta en 1.000 filas y `.limit()` no
  // levanta ese tope, así que el historial completo hay que pedirlo por páginas.
  // El `.order('id')` de desempate mantiene estable el orden entre páginas.
  const pagina = (desde: number, hasta: number) => {
    let q = supabase
      .from('movimientos')
      .select(COLUMNAS_MOV)
      .order('created_at', { ascending: false })
      .order('id')
      .range(desde, hasta)
    // Filtro por clasificación de contrato: sólo movimientos de esas sedes.
    if (sedeIds !== null) q = q.in('sede_id', sedeIds)
    return q
  }

  const contar = () => {
    let q = supabase.from('movimientos').select('id', { count: 'exact', head: true })
    if (sedeIds !== null) q = q.in('sede_id', sedeIds)
    return q
  }

  let movs: MovRow[] = []
  let error: { message: string } | null = null
  let total = 0
  try {
    const [filas, { count }] = await Promise.all([
      traerTodo(pagina, { maximo: MAX_MOVIMIENTOS, etiqueta: 'Movimientos' }),
      contar(),
    ])
    movs = filas as unknown as MovRow[]
    total = count ?? filas.length
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) }
  }

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
        <FiltroClasificacion
          categorias={categorias as Categoria[]}
          etiquetas={etiquetas as Etiqueta[]}
          extras={[{ clave: CLAVE_TIPO_MOV, grupo: 'Movimiento', opciones: TIPO_MOV_META }]}
        />
      </Suspense>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando movimientos: {error.message}
        </div>
      )}

      {movs.length > 0 && movs.length < total && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 font-body text-sm">
          Mostrando los {movs.length.toLocaleString('es-CO')} movimientos más recientes de{' '}
          {total.toLocaleString('es-CO')}. Filtra por contrato para ver los más antiguos.
        </div>
      )}

      {movs.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <ArrowLeftRight className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          {hayFiltro ? (
            <>
              <p className="font-heading font-bold text-lg text-gray-600">Sin resultados</p>
              <p className="font-body text-sm mt-1">Ningún movimiento coincide con los filtros aplicados.</p>
            </>
          ) : (
            <>
              <p className="font-heading font-bold text-lg text-gray-600">Aún no hay movimientos</p>
              <p className="font-body text-sm mt-1">Registra el primer movimiento para empezar la trazabilidad.</p>
              <Link href="/movimientos/nuevo" className="inline-block mt-4 text-brand-green font-body font-semibold text-sm hover:underline">
                Registrar movimiento →
              </Link>
            </>
          )}
        </div>
      ) : (
        <MovimientosClient movs={movs} puedeEliminar={perm.puede('eliminar_movimientos')} />
      )}
    </div>
  )
}
