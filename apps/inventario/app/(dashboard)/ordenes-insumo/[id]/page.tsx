import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { OrdenDetalleClient } from './OrdenDetalleClient'
import { SolicitudItems } from './SolicitudItems'
import { FlujoOrden, type EventoOrden } from './FlujoOrden'
import { DocumentosPDF, type DatosDoc } from './DocumentosPDF'

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
      id, numero, estado, periodo, observacion, created_at, aprobado_at, creado_por,
      aprobado_solicitante_at, aprobado_coordinador_at, recibido_at, recibido_obs,
      alistamiento_iniciado_at, alistado_at, despachado_at, video_path, video_mime,
      sede:sedes ( nombre, grupo:grupos_contrato ( nombre ) ),
      bodega:bodegas ( nombre ),
      items:orden_insumo_items ( id, producto_id, cantidad_solicitada, cantidad_maxima_ref, cantidad_alistada, alistado, alistado_at, es_adicional, modificado_nombre, modificado_at, producto:productos ( nombre_estandar, presentacion ) ),
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

  // El alistamiento SOLO se habilita cuando ya firmaron las dos partes.
  const estado = (orden as unknown as { estado: string }).estado
  const aprobada = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO', 'RECIBIDO'].includes(estado)
  // En la etapa de solicitud (borrador / cambios) se ajustan cantidades y se
  // agregan/quitan productos; el alistamiento no existe todavía.
  const enSolicitud = !aprobada
  const puedeEditarSolicitud = perm.puede('crear_ordenes_insumo') && ['BORRADOR', 'CAMBIOS_SOLICITADOS'].includes(estado)

  const { data: { user } } = await supabase.auth.getUser()

  // Datos planos para los PDF (orden / remisión que viaja con el pedido).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = orden as any
  const datosDoc: DatosDoc = {
    numero: o.numero, estado, created_at: o.created_at,
    aprobado_at: o.aprobado_at ?? null, despachado_at: o.despachado_at ?? null,
    observacion: o.observacion ?? null,
    sede: o.sede?.nombre ?? 'Sin sede',
    grupo: o.sede?.grupo?.nombre ?? null,
    bodega: o.bodega?.nombre ?? null,
    responsables: (o.responsables ?? []).map((r: any) => r.usuario?.nombre).filter(Boolean),
    items: (o.items ?? []).map((i: any) => ({
      nombre: i.producto?.nombre_estandar ?? '—',
      presentacion: i.producto?.presentacion ?? null,
      solicitada: Number(i.cantidad_solicitada ?? 0),
      alistada: Number(i.cantidad_alistada ?? 0),
    })),
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <FlujoOrden
        ordenId={id}
        estado={estado}
        eventos={(eventosData as unknown as EventoOrden[]) ?? []}
        puedeProponer={perm.puede('crear_ordenes_insumo')}
        puedeAprobar={perm.puede('aprobar_ordenes_insumo')}
        firmaSolicitante={o.aprobado_solicitante_at ?? null}
        firmaCoordinador={o.aprobado_coordinador_at ?? null}
        esSolicitante={Boolean(user && o.creado_por === user.id)}
        puedeRecibir={perm.puede('recibir_ordenes_insumo')}
      />
      {/* Etapa de SOLICITUD: ajustar cantidades / agregar / quitar productos. */}
      {enSolicitud && (
        <SolicitudItems
          ordenId={id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items={(o.items ?? []) as any}
          puedeEditar={puedeEditarSolicitud}
        />
      )}

      {/* Etapa de ALISTAMIENTO/DESPACHO: solo una vez aprobada por ambas partes. */}
      {aprobada && (
        <OrdenDetalleClient
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orden={orden as any}
          usuarios={(usuarios ?? []) as { id: string; nombre: string }[]}
          puedeAlistar={perm.puede('alistar_ordenes_insumo')}
        />
      )}
      <DocumentosPDF datos={datosDoc} />
    </div>
  )
}
