import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo, traerTodoPorIds } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import type { Categoria, Etiqueta } from '@/lib/clasificacion'
import { sedesPorClasificacion, leerFiltroClasif, cargarEtiquetas } from '@/lib/clasificacion-server'
import { rangoSemana } from '@/lib/semana'
import { FiltroClasificacion } from '@/components/clasificacion/FiltroClasificacion'
import { FiltroSemana } from '@/components/filtros/FiltroSemana'
import { OrdenesInsumoClient, type OrdenRow } from './OrdenesInsumoClient'
import { PlantillaDownload, type SedeItem } from './PlantillaDownload'
import { SobrePedidos, type ProductoSobrePedido } from './SobrePedidos'

export const metadata: Metadata = { title: 'Órdenes de Insumo' }
export const dynamic = 'force-dynamic'

export default async function OrdenesInsumoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermiso('ver_ordenes_insumo')
  const supabase = await createClient()
  const perm = await getPermisosUsuario()
  const sp = await searchParams

  const { data: { user } } = await supabase.auth.getUser()

  const filtro = leerFiltroClasif(sp)
  const sedeIds = await sedesPorClasificacion(supabase, filtro)
  const semana = rangoSemana(typeof sp.semana === 'string' ? sp.semana : null)

  // Listado de órdenes, paginado: PostgREST devuelve máximo 1.000 filas por
  // respuesta y los filtros de la pantalla se aplican en cliente sobre el total.
  const ordQuery = (desde: number, hasta: number) => {
    let q = supabase
      .from('ordenes_insumo')
      .select(`
        id, numero, estado, periodo, created_at, despachado_at, observacion,
        fecha_entrega_pactada, urgente, creado_por,
        sede:sedes ( nombre ),
        items:orden_insumo_items ( id, alistado ),
        responsables:orden_insumo_responsables ( usuario_id )
      `)
      .order('created_at', { ascending: false })
      .order('id')
    if (sedeIds !== null) q = q.in('sede_id', sedeIds)
    if (semana) q = q.gte('created_at', semana.desde).lt('created_at', semana.hasta)
    return q.range(desde, hasta)
  }

  const [data, { data: sedesData }, { data: misSedes }, { categorias, etiquetas }] = await Promise.all([
    traerTodo(ordQuery),

    // Todas las sedes activas para el selector de plantilla
    traerTodo((desde, hasta) => supabase
      .from('sedes')
      .select('id, nombre, grupo:grupos_contrato ( nombre )')
      .eq('activo', true)
      .order('nombre').order('id')
      .range(desde, hasta)).then((data) => ({ data })),

    // Sedes donde el usuario actual es responsable (para pre-selección)
    user
      ? supabase
          .from('orden_insumo_responsables')
          .select('orden:ordenes_insumo ( sede_id )')
          .eq('usuario_id', user.id)
      : Promise.resolve({ data: [] }),

    // Categorías + etiquetas para el filtro de clasificación
    cargarEtiquetas(supabase),
  ])

  // Nombres de los usuarios (para resolver "creado por"): la vista usuarios_opciones
  // evita la RLS de `usuarios`, así que cualquier autenticado puede resolver el nombre.
  const { data: usuariosData } = await supabase.from('usuarios_opciones').select('id, nombre')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nombrePorUsuario = new Map(((usuariosData ?? []) as any[]).map((u) => [u.id, u.nombre]))

  // ── Comentarios del pedido ─────────────────────────────────────────────────
  // La tabla muestra en una columna la novedad escrita al crear la orden y los
  // comentarios de la trazabilidad. Se leen en lote (y paginados) para no hacer
  // una consulta por orden.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ordenIds = (data as any[]).map((o) => o.id as string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comentariosRows = ordenIds.length
    ? await traerTodoPorIds<any>(ordenIds, (lote, desde, hasta) =>
        supabase
          .from('orden_insumo_eventos')
          .select('id, orden_id, mensaje, usuario_nombre, created_at')
          .eq('tipo', 'COMENTARIO')
          .in('orden_id', lote)
          .order('created_at', { ascending: true })
          .order('id')
          .range(desde, hasta),
        { tamanoLote: 120, etiqueta: 'No se pudieron leer los comentarios' },
      )
    : []

  const comentariosPorOrden = new Map<string, { total: number; ultimo: string | null; autor: string | null }>()
  for (const c of comentariosRows) {
    const previo = comentariosPorOrden.get(c.orden_id) ?? { total: 0, ultimo: null, autor: null }
    const mensaje = (c.mensaje ?? '').trim()
    comentariosPorOrden.set(c.orden_id, {
      total: previo.total + 1,
      // Van en orden ascendente: el último que trae texto es el más reciente.
      ultimo: mensaje || previo.ultimo,
      autor: mensaje ? (c.usuario_nombre ?? null) : previo.autor,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ordenes: OrdenRow[] = (data as any[]).map((o) => ({
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    sede: o.sede?.nombre ?? '—',
    created_at: o.created_at,
    despachado_at: o.despachado_at,
    total_items: o.items?.length ?? 0,
    alistados: (o.items ?? []).filter((i: { alistado: boolean }) => i.alistado).length,
    responsables: o.responsables?.length ?? 0,
    fecha_entrega_pactada: o.fecha_entrega_pactada ?? null,
    urgente: !!o.urgente,
    creador_id: o.creado_por ?? null,
    creador_nombre: (o.creado_por && nombrePorUsuario.get(o.creado_por)) || null,
    observacion: (o.observacion ?? '').trim() || null,
    comentarios: comentariosPorOrden.get(o.id)?.total ?? 0,
    ultimo_comentario: comentariosPorOrden.get(o.id)?.ultimo ?? null,
    comentario_autor: comentariosPorOrden.get(o.id)?.autor ?? null,
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
    ((misSedes ?? []) as any[]).map((r) => r.orden?.sede_id).filter(Boolean) as string[]
  )]

  // ── Productos sobre-pedidos ────────────────────────────────────────────────
  // Disponible proyectado = stock real − lo pedido en órdenes que aún NO salen
  // de bodega (v_stock_proyectado). Si es negativo, se pidió de más.
  //
  // Ojo con dos cosas al leer el reporte:
  //  1) el faltante NO es la suma de las órdenes: es esa suma MENOS el stock;
  //  2) el detalle se pagina (traerTodoPorIds), porque PostgREST corta en 1.000
  //     filas por respuesta y con ~130 productos en déficit el detalle pasa de
  //     las 2.800 filas: sin paginar, el Excel salía con órdenes faltantes.
  const MAX_PRODUCTOS = 300

  const { data: deficitRows } = await supabase
    .from('v_stock_proyectado')
    .select('producto_id, nombre_estandar, presentacion, stock_real, comprometido, disponible')
    .lt('disponible', 0)
    .order('disponible', { ascending: true })
    .limit(MAX_PRODUCTOS)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deficit = (deficitRows ?? []) as any[]
  const deficitIds = deficit.map((r) => r.producto_id)
  let sobrePedidos: ProductoSobrePedido[] = []

  if (deficitIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filas = await traerTodoPorIds<any>(deficitIds, (lote, desde, hasta) =>
      supabase
        .from('v_demanda_ordenes_insumo')
        .select('producto_id, orden_id, orden_numero, estado, sede_nombre, cantidad_solicitada')
        .in('producto_id', lote)
        // `item_id` es la clave única de la vista: sin un desempate único, la
        // paginación por OFFSET repite o pierde filas en el borde de la página
        // (una misma orden aporta una fila por producto, todas con igual
        // created_at y orden_id).
        .order('created_at', { ascending: false })
        .order('item_id')
        .range(desde, hasta),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const demMap = new Map<string, any[]>()
    for (const d of filas) {
      if (!demMap.has(d.producto_id)) demMap.set(d.producto_id, [])
      demMap.get(d.producto_id)!.push(d)
    }

    sobrePedidos = deficit.map((r) => {
      const ordenes = (demMap.get(r.producto_id) ?? []).map((d: { orden_id: string; orden_numero: string; estado: string; sede_nombre: string | null; cantidad_solicitada: number }) => ({
        orden_id: d.orden_id, numero: d.orden_numero, estado: d.estado, sede: d.sede_nombre, cantidad: Number(d.cantidad_solicitada),
      }))
      return {
        producto_id: r.producto_id,
        nombre: r.nombre_estandar ?? 'Producto',
        presentacion: r.presentacion ?? null,
        stock_real: Number(r.stock_real),
        comprometido: Number(r.comprometido),
        disponible: Number(r.disponible),
        ordenes,
      }
    })
  }

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
        <FiltroClasificacion categorias={categorias as Categoria[]} etiquetas={etiquetas as Etiqueta[]} />
      </Suspense>
      <SobrePedidos items={sobrePedidos} />
      <OrdenesInsumoClient
        ordenes={ordenes}
        puedeCrear={perm.puede('crear_ordenes_insumo')}
        estadoInicial={typeof sp.estado === 'string' ? sp.estado : undefined}
      />
    </div>
  )
}
