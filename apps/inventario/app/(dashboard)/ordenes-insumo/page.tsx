import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
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

  let ordQuery = supabase
    .from('ordenes_insumo')
    .select(`
      id, numero, estado, periodo, created_at, despachado_at, observacion,
      fecha_entrega_pactada, urgente,
      sede:sedes ( nombre ),
      items:orden_insumo_items ( id, alistado ),
      responsables:orden_insumo_responsables ( usuario_id )
    `)
    .order('created_at', { ascending: false })
  if (sedeIds !== null) ordQuery = ordQuery.in('sede_id', sedeIds)
  if (semana) ordQuery = ordQuery.gte('created_at', semana.desde).lt('created_at', semana.hasta)

  const [{ data }, { data: sedesData }, { data: misSedes }, { categorias, etiquetas }] = await Promise.all([
    ordQuery,

    // Todas las sedes activas para el selector de plantilla
    supabase
      .from('sedes')
      .select('id, nombre, grupo:grupos_contrato ( nombre )')
      .eq('activo', true)
      .order('nombre'),

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ordenes: OrdenRow[] = ((data ?? []) as any[]).map((o) => ({
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

  // Productos sobre-pedidos: disponible proyectado < 0 (se pidió de más en la cola)
  const { data: deficitRows } = await supabase
    .from('v_stock_proyectado')
    .select('producto_id, stock_real, comprometido, disponible')
    .lt('disponible', 0)
    .order('disponible', { ascending: true })
    .limit(200)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deficitIds = ((deficitRows ?? []) as any[]).map((r) => r.producto_id)
  let sobrePedidos: ProductoSobrePedido[] = []
  if (deficitIds.length > 0) {
    const [{ data: prods }, { data: demanda }] = await Promise.all([
      supabase.from('productos').select('id, nombre_estandar, presentacion').in('id', deficitIds),
      supabase.from('v_demanda_ordenes_insumo').select('producto_id, orden_id, orden_numero, estado, sede_nombre, cantidad_solicitada').in('producto_id', deficitIds).order('created_at', { ascending: false }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prodMap = new Map(((prods ?? []) as any[]).map((p) => [p.id, p]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const demMap = new Map<string, any[]>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of (demanda ?? []) as any[]) {
      if (!demMap.has(d.producto_id)) demMap.set(d.producto_id, [])
      demMap.get(d.producto_id)!.push(d)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sobrePedidos = ((deficitRows ?? []) as any[]).map((r) => {
      const p = prodMap.get(r.producto_id)
      return {
        producto_id: r.producto_id,
        nombre: p?.nombre_estandar ?? 'Producto',
        presentacion: p?.presentacion ?? null,
        stock_real: Number(r.stock_real),
        comprometido: Number(r.comprometido),
        disponible: Number(r.disponible),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ordenes: (demMap.get(r.producto_id) ?? []).map((d: any) => ({
          orden_id: d.orden_id, numero: d.orden_numero, estado: d.estado, sede: d.sede_nombre, cantidad: Number(d.cantidad_solicitada),
        })),
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
