import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { OrdenesInsumoClient, type OrdenRow } from './OrdenesInsumoClient'

export const metadata: Metadata = { title: 'Órdenes de Insumo' }
export const dynamic = 'force-dynamic'

export default async function OrdenesInsumoPage() {
  await requirePermiso('ver_ordenes_insumo')
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  const { data } = await supabase
    .from('ordenes_insumo')
    .select(`
      id, numero, estado, periodo, created_at, despachado_at, observacion,
      sede:sedes ( nombre ),
      items:orden_insumo_items ( id, alistado ),
      responsables:orden_insumo_responsables ( usuario_id )
    `)
    .order('created_at', { ascending: false })

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
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Órdenes de Insumo</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Pedidos por sede para despacho desde bodega · alistamiento y traslado de mercancía
        </p>
      </div>
      <OrdenesInsumoClient ordenes={ordenes} puedeCrear={perm.puede('crear_ordenes_insumo')} />
    </div>
  )
}
