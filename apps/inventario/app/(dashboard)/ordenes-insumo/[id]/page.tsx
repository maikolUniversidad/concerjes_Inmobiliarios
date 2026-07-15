import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { OrdenDetalleClient } from './OrdenDetalleClient'
import { FlujoOrden, type EventoOrden } from './FlujoOrden'

export const metadata: Metadata = { title: 'Orden de insumo' }
export const dynamic = 'force-dynamic'

export default async function OrdenDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermiso('ver_ordenes_insumo')
  const { id } = await params
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  const { data: orden } = await supabase
    .from('ordenes_insumo')
    .select(`
      id, numero, estado, periodo, observacion, created_at,
      alistamiento_iniciado_at, alistado_at, despachado_at, video_path, video_mime,
      sede:sedes ( nombre, grupo:grupos_contrato ( nombre ) ),
      bodega:bodegas ( nombre ),
      items:orden_insumo_items ( id, producto_id, cantidad_solicitada, cantidad_maxima_ref, cantidad_alistada, alistado, alistado_at, producto:productos ( nombre_estandar, presentacion ) ),
      responsables:orden_insumo_responsables ( usuario_id, usuario:usuarios ( id, nombre ) )
    `)
    .eq('id', id)
    .single()

  if (!orden) notFound()

  const [{ data: usuarios }, { data: eventosData }] = await Promise.all([
    supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('orden_insumo_eventos')
      .select('id, tipo, mensaje, estado_anterior, estado_nuevo, usuario_nombre, created_at')
      .eq('orden_id', id).order('created_at', { ascending: true }),
  ])

  // El alistamiento SOLO se habilita cuando la central ya aprobó la propuesta.
  const estado = (orden as unknown as { estado: string }).estado
  const aprobada = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO'].includes(estado)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <FlujoOrden
        ordenId={id}
        estado={estado}
        eventos={(eventosData as unknown as EventoOrden[]) ?? []}
        puedeProponer={perm.puede('crear_ordenes_insumo')}
        puedeAprobar={perm.puede('aprobar_ordenes_insumo')}
      />
      <OrdenDetalleClient
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        orden={orden as any}
        usuarios={(usuarios ?? []) as { id: string; nombre: string }[]}
        puedeAlistar={perm.puede('alistar_ordenes_insumo') && aprobada}
      />
    </div>
  )
}
