import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, GitBranch, ShoppingCart, StickyNote } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import {
  ESTADO_META, ORIGEN_META, PRIORIDAD_META, formatCOP, miles,
  ordenarProductos, puedeConvertirse,
  type EstadoSolicitud, type OrigenSolicitud, type PrioridadSolicitud,
} from '@/lib/solicitudes-compra'
import { AccionesSolicitud } from './AccionesSolicitud'
import { ItemsSolicitud, type ItemSolicitud } from './ItemsSolicitud'

export const metadata: Metadata = { title: 'Solicitud de compra' }
export const dynamic = 'force-dynamic'

export default async function SolicitudDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermiso('solicitar_compras')
  const { id } = await params
  const perm = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: solicitud } = await sb.from('solicitudes_compra')
    .select(`
      id, numero, origen, estado, prioridad, observacion, motivo_cierre,
      solicitado_nombre, created_at, enviada_at, cerrada_at, contrato_id,
      sede:sedes ( id, nombre ), proveedor:proveedores ( id, nombre )
    `)
    .eq('id', id)
    .maybeSingle()
  if (!solicitud) notFound()

  const items = await traerTodo<Record<string, unknown>>((desde, hasta) => sb.from('solicitud_compra_items')
    .select(`
      id, cantidad, cantidad_convertida, precio_ref, fuente_precio, justificacion,
      producto:productos ( id, codigo, nombre_estandar, presentacion ),
      proveedor:proveedores ( nombre ),
      orden_insumo:ordenes_insumo ( id, numero ),
      oc:ordenes_compra ( id, numero_oc, estado )
    `)
    .eq('solicitud_id', id)
    .order('id').range(desde, hasta), { etiqueta: 'Ítems de la solicitud' })

  // Las órdenes de compra que salieron de esta solicitud.
  const { data: ocsData } = await sb.from('ordenes_compra')
    .select('id, numero_oc, estado, valor_total, proveedor:proveedores ( nombre )')
    .eq('solicitud_id', id)
    .order('numero_oc')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocs = ((ocsData ?? []) as any[]).map((o) => ({
    id: o.id as string,
    numero: o.numero_oc as string,
    estado: o.estado as string,
    valor: Number(o.valor_total ?? 0),
    proveedor: (o.proveedor?.nombre ?? null) as string | null,
  }))

  // Orden de los productos: por ítem (código) y después alfabético.
  const filas: ItemSolicitud[] = ordenarProductos(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items.map((i: any) => ({
      id: i.id as string,
      codigo: i.producto?.codigo ?? null,
      nombre: i.producto?.nombre_estandar ?? '',
      presentacion: i.producto?.presentacion ?? null,
      cantidad: Number(i.cantidad ?? 0),
      cantidad_convertida: Number(i.cantidad_convertida ?? 0),
      precio_ref: i.precio_ref == null ? null : Number(i.precio_ref),
      fuente_precio: i.fuente_precio ?? null,
      justificacion: (i.justificacion ?? '').trim() || null,
      proveedor: i.proveedor?.nombre ?? null,
      orden_insumo_id: i.orden_insumo?.id ?? null,
      orden_insumo: i.orden_insumo?.numero ?? null,
      oc_id: i.oc?.id ?? null,
      oc: i.oc?.numero_oc ?? null,
    })),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = solicitud as any
  const estado = s.estado as EstadoSolicitud
  const origen = s.origen as OrigenSolicitud
  const prioridad = s.prioridad as PrioridadSolicitud
  const unidades = filas.reduce((a, f) => a + f.cantidad, 0)
  const valor = filas.reduce((a, f) => a + f.cantidad * (f.precio_ref ?? 0), 0)
  const porConvertir = filas.filter((f) => f.cantidad_convertida < f.cantidad).length
  const sinPrecio = filas.filter((f) => !f.precio_ref).length
  const sinProveedor = filas.filter((f) => !f.proveedor && f.cantidad_convertida < f.cantidad).length

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <Link href="/solicitudes-compra" className="inline-flex items-center gap-1 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="h-4 w-4" /> Solicitudes de compra
      </Link>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-bold text-gray-900">{s.numero}</h1>
              <span className={`rounded-full px-2.5 py-1 font-body text-xs font-medium ${ESTADO_META[estado]?.cls ?? ''}`}>
                {ESTADO_META[estado]?.label ?? estado}
              </span>
              <span className={`rounded-full px-2 py-0.5 font-body text-xs font-medium ${PRIORIDAD_META[prioridad]?.cls ?? ''}`}>
                {PRIORIDAD_META[prioridad]?.label ?? prioridad}
              </span>
            </div>
            <p className="mt-1 font-body text-sm text-gray-500">
              {ORIGEN_META[origen]?.label ?? origen} · {ORIGEN_META[origen]?.detalle}
            </p>
          </div>
          <AccionesSolicitud
            id={s.id}
            numero={s.numero}
            estado={estado}
            puedeSolicitar={perm.puede('solicitar_compras')}
            puedeConvertir={perm.puede('crear_ordenes_compra') && puedeConvertirse(estado) && porConvertir > 0}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: 'Para', v: s.sede?.nombre ?? 'Bodega central' },
            { k: 'Proveedor sugerido', v: s.proveedor?.nombre ?? 'por definir' },
            { k: 'Solicitada por', v: s.solicitado_nombre ?? '—' },
            { k: 'Creada', v: new Date(s.created_at).toLocaleDateString('es-CO') },
            { k: 'Productos', v: `${filas.length}` },
            { k: 'Unidades', v: miles(unidades) },
            { k: 'Valor estimado', v: valor > 0 ? formatCOP(valor) : '—' },
            { k: 'Por convertir', v: `${porConvertir} de ${filas.length}` },
          ].map((d) => (
            <div key={d.k}>
              <dt className="font-body text-xs text-gray-400">{d.k}</dt>
              <dd className="font-body text-sm font-semibold text-gray-900">{d.v}</dd>
            </div>
          ))}
        </dl>

        {s.contrato_id == null && (
          <p className="mt-3 font-body text-xs text-gray-400">
            Sin contrato asociado: el módulo de contratos todavía no llena ese dato.
          </p>
        )}
      </div>

      {s.observacion && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="flex items-center gap-2 font-heading text-sm font-semibold text-amber-900">
            <StickyNote className="h-4 w-4" /> Nota de la solicitud
          </p>
          <p className="mt-2 whitespace-pre-wrap font-body text-sm text-amber-900/90">{s.observacion}</p>
        </div>
      )}

      {s.motivo_cierre && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="font-heading text-sm font-semibold text-red-900">
            {estado === 'RECHAZADA' ? 'Por qué se rechazó' : 'Por qué se cerró'}
          </p>
          <p className="mt-1 whitespace-pre-wrap font-body text-sm text-red-900/90">{s.motivo_cierre}</p>
        </div>
      )}

      {sinProveedor > 0 && puedeConvertirse(estado) && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
          <p className="font-heading text-sm font-semibold text-orange-900">
            {sinProveedor} producto(s) sin proveedor
          </p>
          <p className="mt-1 font-body text-sm text-orange-900/90">
            No tienen precio vigente en el <Link href="/comparador-precios" className="font-semibold underline">comparador</Link> ni
            proveedor en su ficha de <Link href="/productos" className="font-semibold underline">producto</Link>, así que la
            conversión los deja en la solicitud en vez de inventarles uno. Asígnales proveedor y vuelve a convertir.
          </p>
        </div>
      )}

      {ocs.length > 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50/60 p-4 shadow-sm">
          <p className="flex items-center gap-2 font-heading text-sm font-semibold text-green-900">
            <ShoppingCart className="h-4 w-4" /> Órdenes de compra generadas
          </p>
          <ul className="mt-2 space-y-1">
            {ocs.map((o) => (
              <li key={o.id} className="font-body text-sm text-green-900/90">
                <Link href={`/ordenes-compra/${o.id}`} className="font-mono font-semibold underline">{o.numero}</Link>
                {' · '}{o.proveedor ?? 'sin proveedor'}{' · '}{formatCOP(o.valor)}
                {' · '}{o.estado.replace(/_/g, ' ').toLowerCase()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {filas.some((f) => f.orden_insumo) && (
        <p className="flex items-center gap-2 font-body text-xs text-gray-500">
          <GitBranch className="h-3.5 w-3.5" />
          Esta solicitud nació de una orden pendiente por falta de stock: cada producto conserva el enlace a la orden que lo pidió.
        </p>
      )}

      <ItemsSolicitud items={filas} sinPrecio={sinPrecio} />
    </div>
  )
}
