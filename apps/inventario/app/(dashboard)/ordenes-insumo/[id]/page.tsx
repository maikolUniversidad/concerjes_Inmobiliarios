import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { StickyNote } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { OrdenDetalleClient } from './OrdenDetalleClient'
import { SolicitudItems } from './SolicitudItems'
import { FlujoOrden, type EventoOrden } from './FlujoOrden'
import { DocumentosPDF, type DatosDoc } from './DocumentosPDF'
import { BorrarOrdenBtn } from './BorrarOrdenBtn'
import { UrgenciaEditor } from './UrgenciaEditor'
import { DevolucionOrden } from './DevolucionOrden'
import { EnvioRestante } from './EnvioRestante'

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
      fecha_entrega_pactada, urgente,
      aprobado_solicitante_at, aprobado_coordinador_at, recibido_at, recibido_obs,
      alistamiento_iniciado_at, alistado_at, despachado_at, video_path, video_mime,
      tipo_despacho, transportadora_nombre, transportadora_guia, sede_id,
      conductor:usuarios!ordenes_insumo_conductor_id_fkey ( nombre ),
      sede:sedes ( nombre, direccion, grupo:grupos_contrato ( nombre ) ),
      bodega:bodegas ( nombre ),
      items:orden_insumo_items ( id, producto_id, cantidad_solicitada, cantidad_maxima_ref, cantidad_alistada, cantidad_devuelta, alistado, alistado_at, es_adicional, modificado_nombre, modificado_at, producto:productos ( nombre_estandar, presentacion, imagen_url, codigo, stock ( cantidad_disp ) ) ),
      responsables:orden_insumo_responsables ( usuario_id, usuario:usuarios ( id, nombre ) )
    `)
    .eq('id', id)
    .single()

  if (!orden) notFound()

  // Devoluciones de la orden (qué productos y cuánto regresó la sede).
  const { data: devolucionesData } = await supabase
    .from('orden_insumo_devoluciones')
    .select(`
      id, motivo, observacion, reingresa_stock, total_unidades, registrado_nombre, created_at,
      items:orden_insumo_devolucion_items ( id, cantidad, producto:productos ( nombre_estandar, presentacion ) )
    `)
    .eq('orden_id', id)
    .order('created_at', { ascending: false })

  const { data: eventosData } = await supabase.from('orden_insumo_eventos')
    .select('id, tipo, mensaje, estado_anterior, estado_nuevo, usuario_nombre, created_at')
    .eq('orden_id', id).order('created_at', { ascending: true })

  // El alistamiento SOLO se habilita cuando ya firmaron las dos partes.
  const estado = (orden as unknown as { estado: string }).estado
  const aprobada = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO', 'RECIBIDO'].includes(estado)
  // La solicitud de ítems se muestra siempre; en estados aprobados también
  // se puede editar (novedad post-aprobación) y queda en trazabilidad.
  const puedeEditarSolicitud =
    (perm.puede('crear_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo'))
    && ['BORRADOR', 'CAMBIOS_SOLICITADOS', 'EN_REVISION', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO'].includes(estado)

  const { data: { user } } = await supabase.auth.getUser()

  // Borrar solo se ofrece mientras la orden no haya movido inventario ni salido
  // a ruta (para esas se usa Anular, que conserva el histórico).
  const puedeBorrar =
    (perm.puede('crear_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo'))
    && !['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO'].includes(estado)

  // La prioridad (urgente / fecha de entrega) se puede ajustar mientras la orden
  // siga en curso (no recibida ni anulada).
  const puedeEditarUrgencia =
    (perm.puede('crear_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo') || perm.puede('alistar_ordenes_insumo'))
    && !['RECIBIDO', 'ANULADA'].includes(estado)

  // Devoluciones: solo tienen sentido cuando el pedido ya salió de la bodega.
  const despachada = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO'].includes(estado)
  const puedeDevolver = perm.puede('alistar_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo')

  // Datos planos para los PDF (orden / remisión que viaja con el pedido).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = orden as any
  const datosDoc: DatosDoc = {
    ordenId: id,
    sedeId: o.sede_id ?? '',
    numero: o.numero, estado, created_at: o.created_at,
    aprobado_at: o.aprobado_at ?? null, despachado_at: o.despachado_at ?? null,
    observacion: o.observacion ?? null,
    sede: o.sede?.nombre ?? 'Sin sede',
    direccion: o.sede?.direccion ?? null,
    grupo: o.sede?.grupo?.nombre ?? null,
    bodega: o.bodega?.nombre ?? null,
    responsables: (o.responsables ?? []).map((r: any) => r.usuario?.nombre).filter(Boolean),
    items: (o.items ?? []).map((i: any) => ({
      codigo: i.producto?.codigo ?? null,
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
      {/* Novedad del pedido: la nota que se escribe al crear la orden. Se muestra
          siempre (también en borrador) para que no se pierda en el proceso. */}
      {o.observacion && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm">
          <p className="font-heading font-semibold text-sm text-amber-900 flex items-center gap-2">
            <StickyNote className="w-4 h-4" /> Novedad del pedido
          </p>
          <p className="mt-2 font-body text-sm text-amber-900/90 whitespace-pre-wrap">{o.observacion}</p>
        </div>
      )}
      <UrgenciaEditor
        ordenId={id}
        estado={estado}
        urgente={!!o.urgente}
        fechaEntrega={o.fecha_entrega_pactada ?? null}
        puedeEditar={puedeEditarUrgencia}
      />
      {/* Ítems de la solicitud: siempre visible. En estados aprobados, los cambios
          quedan como novedad en la trazabilidad y generan notificación. */}
      <SolicitudItems
        ordenId={id}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items={(o.items ?? []) as any}
        puedeEditar={puedeEditarSolicitud}
        esAprobada={aprobada}
      />

      {/* Etapa de ALISTAMIENTO/DESPACHO: solo una vez aprobada por ambas partes. */}
      {aprobada && (
        <OrdenDetalleClient
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orden={orden as any}
          puedeAlistar={perm.puede('alistar_ordenes_insumo')}
        />
      )}
      {/* Envío restante: si salió con productos pendientes, despachar lo que falta. */}
      {despachada && (
        <EnvioRestante
          ordenId={id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items={(o.items ?? []) as any}
          puedeAlistar={perm.puede('alistar_ordenes_insumo')}
        />
      )}
      {/* Devoluciones del pedido (parciales, con reingreso de stock si aplica). */}
      {despachada && (
        <DevolucionOrden
          ordenId={id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items={(o.items ?? []) as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          devoluciones={(devolucionesData ?? []) as any}
          puedeDevolver={puedeDevolver}
        />
      )}
      <DocumentosPDF datos={datosDoc} />
      {puedeBorrar && <BorrarOrdenBtn ordenId={id} numero={o.numero} />}
    </div>
  )
}
