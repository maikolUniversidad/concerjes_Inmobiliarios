import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import type { Categoria, Etiqueta } from '@/lib/clasificacion'
import { sedesPorClasificacion, leerFiltroClasif, cargarEtiquetas } from '@/lib/clasificacion-server'
import { rangoSemana } from '@/lib/semana'
import { FiltroClasificacion } from '@/components/clasificacion/FiltroClasificacion'
import { FiltroSemana } from '@/components/filtros/FiltroSemana'
import { OrdenesInsumoClient, type OrdenRow } from './OrdenesInsumoClient'
import { PlantillaDownload, type SedeItem } from './PlantillaDownload'
import { SobrePedidosPanel } from './SobrePedidosPanel'

export const metadata: Metadata = { title: 'Órdenes de Insumo' }
export const dynamic = 'force-dynamic'

export default async function OrdenesInsumoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const perm = await requirePermiso('ver_ordenes_insumo')
  const supabase = await createClient()
  const sp = await searchParams

  const filtro = leerFiltroClasif(sp)
  const semana = rangoSemana(typeof sp.semana === 'string' ? sp.semana : null)

  // ── Listado de órdenes ─────────────────────────────────────────────────────
  // Una fila por orden, con los contadores (ítems, alistados, sin stock,
  // responsables, comentarios, nivel de reposición, nombre del creador) ya
  // resueltos en SQL por `v_ordenes_insumo_lista`.
  //
  // Antes esto eran ~8 peticiones encadenadas, y la primera se traía los ~10.000
  // ítems de todas las órdenes con su producto y su stock anidados (2,4 MB) solo
  // para contar tres números por orden. Esa consulta promediaba 617 ms con picos
  // de 7,9 s; como `authenticated` tiene statement_timeout = 8 s, cuando la base
  // estaba ocupada se pasaba del tope, PostgREST devolvía 500 y la pantalla caía
  // en el aviso de "Esta pantalla no se pudo cargar".
  //
  // Sigue paginado: PostgREST corta toda respuesta en 1.000 filas y los filtros
  // de la pantalla se aplican en cliente sobre el total.
  // El filtro de clasificación necesita saber antes qué sedes entran; sin filtro
  // activo devuelve null y no se consulta nada.
  const sedeIds = await sedesPorClasificacion(supabase, filtro)

  const listado = (desde: number, hasta: number) => {
    let q = supabase
      .from('v_ordenes_insumo_lista')
      .select(`
        id, numero, estado, sede, created_at, despachado_at, alistado_at,
        tomado_ruta_at, recibido_at, fecha_entrega_pactada, urgente,
        creador_id, creador_nombre, observacion, total_items, alistados,
        sin_stock, responsables, comentarios, ultimo_comentario,
        comentario_autor, reposicion
      `)
      .order('created_at', { ascending: false })
      .order('id')
    if (sedeIds !== null) q = q.in('sede_id', sedeIds)
    if (semana) q = q.gte('created_at', semana.desde).lt('created_at', semana.hasta)
    return q.range(desde, hasta)
  }

  const [data, sedesData, misSedesData, { categorias, etiquetas }] = await Promise.all([
    traerTodo<OrdenRow>(listado),

    // Todas las sedes activas para el selector de plantilla
    traerTodo((desde, hasta) => supabase
      .from('sedes')
      .select('id, nombre, grupo:grupos_contrato ( nombre )')
      .eq('activo', true)
      .order('nombre').order('id')
      .range(desde, hasta)),

    // Sedes donde el usuario actual es responsable (para pre-selección en la
    // plantilla). `auth.getUser()` es una llamada de red más, así que se
    // resuelve en paralelo con el resto y no antes.
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data } = await supabase
        .from('orden_insumo_responsables')
        .select('orden:ordenes_insumo ( sede_id )')
        .eq('usuario_id', user.id)
      return data ?? []
    })(),

    // Categorías + etiquetas para el filtro de clasificación
    cargarEtiquetas(supabase),
  ])

  const ordenes: OrdenRow[] = data.map((o) => ({
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    sede: o.sede ?? '—',
    created_at: o.created_at,
    despachado_at: o.despachado_at,
    alistado_at: o.alistado_at ?? null,
    tomado_ruta_at: o.tomado_ruta_at ?? null,
    recibido_at: o.recibido_at ?? null,
    total_items: Number(o.total_items ?? 0),
    alistados: Number(o.alistados ?? 0),
    sin_stock: Number(o.sin_stock ?? 0),
    reposicion: Number(o.reposicion ?? 0),
    responsables: Number(o.responsables ?? 0),
    fecha_entrega_pactada: o.fecha_entrega_pactada ?? null,
    urgente: !!o.urgente,
    creador_id: o.creador_id ?? null,
    creador_nombre: o.creador_nombre ?? null,
    observacion: o.observacion ?? null,
    comentarios: Number(o.comentarios ?? 0),
    ultimo_comentario: o.ultimo_comentario ?? null,
    comentario_autor: o.comentario_autor ?? null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedes: SedeItem[] = ((sedesData ?? []) as any[]).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    grupo: s.grupo?.nombre ?? null,
  }))

  // IDs únicos de sedes donde el usuario es responsable
  const miSedesIds = [...new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((misSedesData ?? []) as any[]).map((r) => r.orden?.sede_id).filter(Boolean) as string[]
  )]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Órdenes de Insumo</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Pedidos por sede para despacho desde bodega · alistamiento y traslado de mercancía
          </p>
        </div>
        <PlantillaDownload sedes={sedes} misSedes={miSedesIds} />
      </div>
      <Suspense fallback={null}>
        <FiltroSemana />
      </Suspense>
      <Suspense fallback={null}>
        <FiltroClasificacion
          categorias={categorias as Categoria[]}
          etiquetas={etiquetas as Etiqueta[]}
          extras={[{ clave: 'semana', grupo: 'Semana', formato: 'semana' }]}
        />
      </Suspense>
      {/* Llega en streaming: la tabla de abajo no espera a que esto termine. */}
      <Suspense fallback={null}>
        <SobrePedidosPanel />
      </Suspense>
      <OrdenesInsumoClient
        ordenes={ordenes}
        puedeCrear={perm.puede('crear_ordenes_insumo')}
        estadoInicial={typeof sp.estado === 'string' ? sp.estado : undefined}
      />
    </div>
  )
}
