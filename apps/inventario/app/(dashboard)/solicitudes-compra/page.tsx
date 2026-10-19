import type { Metadata } from 'next'
import { ShoppingCart } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { ListaSolicitudes, type SolicitudFila } from './ListaSolicitudes'
import { PendientesSinSolicitud, type PendienteFila } from './PendientesSinSolicitud'

export const metadata: Metadata = { title: 'Solicitudes de Compra' }
export const dynamic = 'force-dynamic'

export default async function SolicitudesCompraPage() {
  // La pantalla la ve quien pide y quien compra. La RLS acepta los mismos tres
  // permisos, así que la lista nunca muestra más de lo que la base deja leer.
  await requirePermiso('solicitar_compras')
  const perm = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Paginado: PostgREST corta en 1.000 filas por respuesta.
  const [solicitudes, items, pendientes] = await Promise.all([
    traerTodo<Record<string, unknown>>((desde, hasta) => sb.from('solicitudes_compra')
      .select(`
        id, numero, origen, estado, prioridad, observacion, motivo_cierre,
        solicitado_nombre, created_at, enviada_at, cerrada_at,
        sede:sedes ( nombre ), proveedor:proveedores ( nombre )
      `)
      .order('created_at', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'Solicitudes de compra' }),

    traerTodo<Record<string, unknown>>((desde, hasta) => sb.from('solicitud_compra_items')
      .select('id, solicitud_id, cantidad, cantidad_convertida, precio_ref')
      .order('id').range(desde, hasta), { etiqueta: 'Ítems de las solicitudes' }),

    traerTodo<Record<string, unknown>>((desde, hasta) => sb.from('v_sc_pendientes_sin_solicitud')
      .select('orden_insumo_id, numero, estado, created_at, urgente, sede, orden_origen, items, unidades, valor_estimado')
      .order('created_at', { ascending: false }).order('orden_insumo_id').range(desde, hasta),
      { etiqueta: 'Órdenes pendientes sin solicitud' }),
  ])

  // Totales por solicitud: cuántos productos, cuántas unidades, cuánto vale y
  // cuánto queda por convertir en orden de compra.
  const resumen = new Map<string, { items: number; unidades: number; valor: number; pendientes: number }>()
  for (const it of items) {
    const sid = String(it.solicitud_id)
    const prev = resumen.get(sid) ?? { items: 0, unidades: 0, valor: 0, pendientes: 0 }
    const cantidad = Number(it.cantidad ?? 0)
    const convertida = Number(it.cantidad_convertida ?? 0)
    resumen.set(sid, {
      items: prev.items + 1,
      unidades: prev.unidades + cantidad,
      valor: prev.valor + cantidad * Number(it.precio_ref ?? 0),
      pendientes: prev.pendientes + (convertida < cantidad ? 1 : 0),
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filas: SolicitudFila[] = solicitudes.map((s: any) => ({
    id: s.id,
    numero: s.numero,
    origen: s.origen,
    estado: s.estado,
    prioridad: s.prioridad,
    sede: s.sede?.nombre ?? null,
    proveedor: s.proveedor?.nombre ?? null,
    solicitante: s.solicitado_nombre ?? null,
    created_at: s.created_at,
    observacion: (s.observacion ?? '').trim() || null,
    motivo_cierre: (s.motivo_cierre ?? '').trim() || null,
    items: resumen.get(s.id)?.items ?? 0,
    unidades: resumen.get(s.id)?.unidades ?? 0,
    valor: resumen.get(s.id)?.valor ?? 0,
    por_convertir: resumen.get(s.id)?.pendientes ?? 0,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pend: PendienteFila[] = pendientes.map((p: any) => ({
    orden_insumo_id: p.orden_insumo_id,
    numero: p.numero,
    estado: p.estado,
    created_at: p.created_at,
    urgente: !!p.urgente,
    sede: p.sede ?? null,
    orden_origen: p.orden_origen ?? null,
    items: Number(p.items ?? 0),
    unidades: Number(p.unidades ?? 0),
    valor_estimado: Number(p.valor_estimado ?? 0),
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-brand-green" /> Solicitudes de Compra
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Lo que alguien necesita comprar, antes de que exista la orden. No es un paso obligatorio:
          compras también puede crear la orden directo.
        </p>
      </div>

      <PendientesSinSolicitud pendientes={pend} puedeSolicitar={perm.puede('solicitar_compras')} />

      <ListaSolicitudes
        solicitudes={filas}
        puedeConvertir={perm.puede('crear_ordenes_compra')}
      />
    </div>
  )
}
