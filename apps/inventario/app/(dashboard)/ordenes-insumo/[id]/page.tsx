import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { StickyNote, GitBranch } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { OrdenDetalleClient } from './OrdenDetalleClient'
import { SolicitudItems } from './SolicitudItems'
import { FlujoOrden, type EventoOrden } from './FlujoOrden'
import { DocumentosPDF, type DatosDoc } from './DocumentosPDF'
import { BorrarOrdenBtn } from './BorrarOrdenBtn'
import { UrgenciaEditor } from './UrgenciaEditor'
import { SedeEditor } from './SedeEditor'
import { DevolucionOrden } from './DevolucionOrden'
import { EnvioRestante } from './EnvioRestante'
import { SolicitudCompraPendiente } from './SolicitudCompraPendiente'
import { ESTADOS_PENDIENTE_SOLICITABLE } from '@/lib/solicitudes-compra'

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
      alistamiento_iniciado_at, alistado_at, despachado_at, video_path, video_mime, video_duracion_s,
      tipo_despacho, transportadora_nombre, transportadora_guia, sede_id, orden_origen_id,
      origen:orden_origen_id ( id, numero ),
      conductor:usuarios!ordenes_insumo_conductor_id_fkey ( nombre ),
      sede:sedes ( nombre, direccion, grupo:grupos_contrato ( nombre ) ),
      bodega:bodegas ( nombre ),
      items:orden_insumo_items ( id, producto_id, cantidad_solicitada, cantidad_maxima_ref, cantidad_alistada, cantidad_devuelta, cantidad_a_pendiente, alistado, alistado_at, es_adicional, modificado_nombre, modificado_at, producto:productos ( nombre_estandar, presentacion, imagen_url, codigo, stock ( cantidad_real, cantidad_disp ) ) ),
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

  // Órdenes pendientes que se generaron desde esta (lo que no salió en su despacho).
  const { data: hijasData } = await supabase.from('ordenes_insumo')
    .select('id, numero, estado').eq('orden_origen_id', id).order('created_at')
  const hijas = (hijasData ?? []) as unknown as { id: string; numero: string; estado: string }[]

  // Reposición N: cuántas pendientes hay en la cadena hasta la orden original
  // (1 = pendiente de la original, 2 = pendiente de una pendiente…).
  let reposicion = 0
  let origenRaizNumero: string | null = null
  let actual = (orden as unknown as { orden_origen_id: string | null }).orden_origen_id
  while (actual && reposicion < 20) {
    reposicion++
    const { data: ant } = await supabase.from('ordenes_insumo')
      .select('numero, orden_origen_id').eq('id', actual).single()
    const a = ant as unknown as { numero: string; orden_origen_id: string | null } | null
    if (!a) break
    origenRaizNumero = a.numero
    actual = a.orden_origen_id
  }

  // Solicitudes de compra que salieron de esta orden pendiente (fase 2 de
  // compras). Se leen por los ítems, que son los que guardan el enlace.
  //
  // `puedeVerSolicitudes` son los mismos tres permisos de la política
  // `sc_items_read`. Sin ellos la consulta vuelve VACÍA por RLS, sin error: hay
  // que distinguir «no hay solicitud» de «no puedes verla», porque si no la
  // pantalla le jura a un conserje que nadie pidió su insumo y lo reclama otra
  // vez.
  const puedeVerSolicitudes = perm.puede('solicitar_compras')
    || perm.puede('ver_ordenes_compra')
    || perm.puede('crear_ordenes_compra')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: solCompraData } = await (supabase as any)
    .from('solicitud_compra_items')
    .select('solicitud:solicitudes_compra ( id, numero, estado )')
    .eq('orden_insumo_id', id)
  const solicitudesCompra = [...new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((solCompraData ?? []) as any[])
      .map((r) => r.solicitud)
      .filter((x) => x && x.estado !== 'ANULADA')
      .map((x) => [x.id as string, { id: x.id as string, numero: x.numero as string, estado: x.estado as string }]),
  ).values()]

  const { data: eventosData } = await supabase.from('orden_insumo_eventos')
    .select('id, tipo, mensaje, estado_anterior, estado_nuevo, usuario_nombre, created_at')
    .eq('orden_id', id).order('created_at', { ascending: true })

  // El alistamiento SOLO se habilita cuando ya firmaron las dos partes.
  const estado = (orden as unknown as { estado: string }).estado
  const aprobada = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO'].includes(estado)
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

  // La sede de destino se puede corregir mientras el pedido no haya llegado
  // (se elige mal al crear la orden más seguido de lo que parece).
  const puedeEditarSede =
    (perm.puede('crear_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo'))
    && !['ENTREGADO', 'RECIBIDO', 'ANULADA'].includes(estado)

  // La prioridad (urgente / fecha de entrega) se puede ajustar mientras la orden
  // siga en curso (no recibida ni anulada).
  const puedeEditarUrgencia =
    (perm.puede('crear_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo') || perm.puede('alistar_ordenes_insumo'))
    && !['RECIBIDO', 'ANULADA'].includes(estado)

  // Devoluciones: solo tienen sentido cuando el pedido ya salió de la bodega.
  const despachada = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO'].includes(estado)
  const puedeDevolver = perm.puede('alistar_ordenes_insumo') || perm.puede('aprobar_ordenes_insumo')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = orden as any

  // Lo que pasó a la reposición ya no es de esta orden: se descuenta de lo
  // solicitado y, si se fue completo, el ítem no se muestra aquí (ni en sus PDF).
  // `cantidad_a_pendiente` queda en 0 en la copia para que "Envío restante" no lo
  // descuente dos veces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemsTodos = (o.items ?? []) as any[]
  const itemsVisibles = itemsTodos
    .filter((i) => !(Number(i.cantidad_a_pendiente ?? 0) > 0 && Number(i.cantidad_alistada ?? 0) <= 0
      && Number(i.cantidad_solicitada ?? 0) <= Number(i.cantidad_a_pendiente ?? 0)))
    .map((i) => ({
      ...i,
      cantidad_solicitada: Math.max(0, Number(i.cantidad_solicitada ?? 0) - Number(i.cantidad_a_pendiente ?? 0)),
      cantidad_a_pendiente: 0,
    }))
  const itemsMovidos = itemsTodos.length - itemsVisibles.length
  o.items = itemsVisibles

  // Datos planos para los PDF (orden / remisión que viaja con el pedido).
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
      alistado: !!i.alistado,
    })),
    origenNumero: o.origen?.numero ?? null,
    pendientesNumeros: hijas.map((h) => h.numero),
    reposicion,
    origenRaizNumero,
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
      {/* Trazabilidad entre la orden y su(s) pendiente(s). */}
      {(o.origen || hijas.length > 0) && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 shadow-sm space-y-1.5">
          <p className="font-heading font-semibold text-sm text-orange-900 flex items-center gap-2">
            <GitBranch className="w-4 h-4" /> {o.origen ? 'Orden de reposición' : 'Quedó pendiente'}
            {reposicion > 0 && (
              <span className="rounded-full bg-orange-600 px-2.5 py-0.5 font-body text-xs font-bold text-white">
                Reposición {reposicion}
              </span>
            )}
          </p>
          {o.origen && (
            <p className="font-body text-sm text-orange-900/90">
              Viene de la orden{' '}
              <Link href={`/ordenes-insumo/${o.origen.id}`} className="font-semibold underline">{o.origen.numero}</Link>
              : son los productos que no salieron en su despacho.
              {reposicion > 1 && origenRaizNumero && <> Orden original: <strong>{origenRaizNumero}</strong>.</>}
            </p>
          )}
          {hijas.map((h) => (
            <p key={h.id} className="font-body text-sm text-orange-900/90">
              Lo que no salió en el despacho sigue en la reposición{' '}
              <Link href={`/ordenes-insumo/${h.id}`} className="font-semibold underline">{h.numero}</Link>
              {' '}({h.estado.replace(/_/g, ' ').toLowerCase()}).
            </p>
          ))}
          {/* La pendiente nace porque faltó stock: de aquí sale la solicitud de compra. */}
          {o.origen && (
            <SolicitudCompraPendiente
              ordenId={id}
              solicitudes={solicitudesCompra}
              puedeVerSolicitudes={puedeVerSolicitudes}
              puedeSolicitar={perm.puede('solicitar_compras')
                && (ESTADOS_PENDIENTE_SOLICITABLE as readonly string[]).includes(estado)}
            />
          )}
          {hijas.length > 0 && (
            <p className="font-body text-xs text-orange-900/70">
              {itemsMovidos > 0 ? `${itemsMovidos} producto(s) que no salieron ya no se listan en esta orden; ` : 'Aquí solo queda lo que salió en el despacho; '}
              los ves en la reposición.
            </p>
          )}
        </div>
      )}
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
      <SedeEditor
        ordenId={id}
        sedeId={o.sede_id ?? null}
        sedeNombre={o.sede?.nombre ?? null}
        grupo={o.sede?.grupo?.nombre ?? null}
        direccion={o.sede?.direccion ?? null}
        estado={estado}
        puedeEditar={puedeEditarSede}
      />
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
        estado={estado}
        despachadoAt={o.despachado_at ?? null}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items={(o.items ?? []) as any}
        puedeEditar={puedeEditarSolicitud}
        esAprobada={aprobada}
        enAlistamiento={['EN_ALISTAMIENTO', 'ALISTADO'].includes(estado)}
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
