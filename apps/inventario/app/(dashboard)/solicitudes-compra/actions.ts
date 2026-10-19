'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso, SIN_PERMISO } from '@/lib/permisos-server'

export interface ActionResult { error?: string }

/**
 * Solicitud de compra (fase 2 del módulo de compras).
 *
 * La solicitud NO es obligatoria: compras sigue creando la orden directo
 * (decisión §7.1 de docs/modulo-compras.md). Estas acciones son la vía opcional
 * —y la automática de las órdenes pendientes por falta de stock—.
 *
 * Toda la escritura pasa por los RPC `sc_*`: son SECURITY DEFINER, validan el
 * permiso y hacen la numeración con reintento en una sola transacción. Las
 * tablas no tienen política de escritura a propósito, igual que las de entrega
 * de la fase 1.
 */
const PERM_SOLICITAR = 'solicitar_compras'
const PERM_COMPRAS = 'crear_ordenes_compra'

/** Traduce al español los errores que llegan de la base. */
function traducir(msg: string): string {
  if (msg.includes('row-level security')) return SIN_PERMISO
  // Las excepciones de los RPC ya vienen escritas para el usuario.
  return msg.replace(/^.*?ERROR:\s*/, '')
}

async function sesion() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

export interface SolicitudGenerada {
  solicitud_id: string
  numero: string
  proveedor_id: string | null
  proveedor: string | null
  productos: number
}

/**
 * Genera las solicitudes de la recomendación de compra en vivo, UNA POR
 * PROVEEDOR. El proveedor y el precio los decide la base
 * (`v_recomendacion_compra_proveedor`), no la pantalla: así la solicitud no
 * puede prometer un precio que la orden no vaya a usar.
 *
 * `productos` vacío = todo lo recomendado.
 */
export async function generarSolicitudesRecomendacion(
  productos: { producto_id: string; cantidad?: number }[],
  prioridad: 'BAJA' | 'NORMAL' | 'ALTA' | 'URGENTE' = 'NORMAL',
): Promise<ActionResult & { solicitudes?: SolicitudGenerada[] }> {
  const falta = await faltaPermiso(PERM_SOLICITAR)
  if (falta) return { error: falta }
  const { sb, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const items = (productos ?? [])
    .filter((p) => p.producto_id)
    .map((p) => ({
      producto_id: p.producto_id,
      cantidad: Number.isFinite(Number(p.cantidad)) && Number(p.cantidad) > 0 ? Number(p.cantidad) : null,
    }))

  const { data, error } = await sb.rpc('sc_generar_desde_recomendacion', {
    p_items: items.length > 0 ? items : null,
    p_prioridad: prioridad,
  })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/solicitudes-compra')
  revalidatePath('/aprovisionamiento')
  return { solicitudes: (data?.solicitudes ?? []) as SolicitudGenerada[] }
}

/**
 * Genera la solicitud de una orden pendiente por falta de stock. Es la única
 * puerta donde la solicitud sale gratis: el sistema ya sabe qué producto,
 * cuánto, para qué sede y quién lo pidió.
 */
export async function generarSolicitudPendiente(ordenInsumoId: string): Promise<ActionResult & { id?: string }> {
  const falta = await faltaPermiso(PERM_SOLICITAR)
  if (falta) return { error: falta }
  const { sb, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  if (!ordenInsumoId) return { error: 'Falta la orden pendiente.' }

  const { data, error } = await sb.rpc('sc_generar_desde_pendiente', { p_orden: ordenInsumoId })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/solicitudes-compra')
  revalidatePath(`/ordenes-insumo/${ordenInsumoId}`)
  return { id: data as string }
}

/** Crea una solicitud a mano (origen MANUAL). */
export async function crearSolicitudManual(entrada: {
  sedeId?: string | null
  prioridad?: string
  observacion?: string | null
  items: { productoId: string; cantidad: number; justificacion?: string | null }[]
}): Promise<ActionResult & { id?: string }> {
  const falta = await faltaPermiso(PERM_SOLICITAR)
  if (falta) return { error: falta }
  const { sb, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const items = (entrada.items ?? [])
    .filter((i) => i.productoId && Number(i.cantidad) > 0)
    .map((i) => ({
      producto_id: i.productoId,
      cantidad: Number(i.cantidad),
      justificacion: i.justificacion?.trim() || null,
    }))
  if (items.length === 0) return { error: 'Agrega al menos un producto con cantidad.' }

  const { data, error } = await sb.rpc('sc_crear', {
    p_items: items,
    p_origen: 'MANUAL',
    p_sede: entrada.sedeId || null,
    p_prioridad: entrada.prioridad || 'NORMAL',
    p_observacion: entrada.observacion?.trim() || null,
  })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/solicitudes-compra')
  return { id: data as string }
}

export interface OCGenerada {
  oc_id: string
  numero: string
  proveedor: string | null
  valor: number
}

/**
 * Convierte la solicitud en orden(es) de compra: UNA POR PROVEEDOR, con el
 * precio del comparador cuando lo hay y el de lista cuando no.
 *
 * Crear la orden es trabajo de compras, así que pide `crear_ordenes_compra`.
 * Los productos sin proveedor se quedan en la solicitud y vienen contados en
 * `sinProveedor`: no se les inventa un proveedor.
 */
export async function convertirSolicitudEnOC(
  id: string,
): Promise<ActionResult & { ordenes?: OCGenerada[]; sinProveedor?: number }> {
  const falta = await faltaPermiso(PERM_COMPRAS)
  if (falta) return { error: falta }
  const { sb, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data, error } = await sb.rpc('sc_convertir_a_oc', { p_solicitud: id })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/solicitudes-compra')
  revalidatePath(`/solicitudes-compra/${id}`)
  revalidatePath('/ordenes-compra')
  return {
    ordenes: (data?.ordenes ?? []) as OCGenerada[],
    sinProveedor: Number(data?.sin_proveedor ?? 0),
  }
}

/** Enviar, rechazar o anular una solicitud. Rechazar es de compras. */
export async function cambiarEstadoSolicitud(
  id: string,
  estado: 'ENVIADA' | 'RECHAZADA' | 'ANULADA',
  motivo?: string,
): Promise<ActionResult> {
  const falta = estado === 'RECHAZADA'
    ? await faltaPermiso(PERM_COMPRAS)
    : await faltaPermiso(PERM_SOLICITAR)
  if (falta) return { error: falta }
  const { sb, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }

  if (estado !== 'ENVIADA' && !motivo?.trim()) return { error: 'Escribe el motivo.' }

  const { error } = await sb.rpc('sc_cambiar_estado', {
    p_solicitud: id,
    p_estado: estado,
    p_motivo: motivo?.trim() || null,
  })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/solicitudes-compra')
  revalidatePath(`/solicitudes-compra/${id}`)
  return {}
}
