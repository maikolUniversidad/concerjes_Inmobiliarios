'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso, SIN_PERMISO } from '@/lib/permisos-server'

export interface ActionResult { error?: string }

/**
 * Separación de funciones (fase 1 del módulo de compras).
 *
 * Antes un solo permiso, `crear_ordenes_compra`, autorizaba crear, aprobar,
 * enviar, recibir y anular. Ahora son tres manos distintas:
 *
 *   crear_ordenes_compra     crear, editar ítems, marcar como comprada, anular
 *   aprobar_ordenes_compra   aprobar (con tope de monto)
 *   recibir_ordenes_compra   registrar las entregas del proveedor
 *
 * Lo que NO se valida aquí: la regla «quien crea no aprueba» y el tope por
 * monto. Esos dos viven en el trigger `tr_oc_aprobacion` de la base, porque
 * `getPermisosUsuario()` y los helpers `auth_permiso*` le dan paso libre a los
 * roles base SUPER_ADMIN y ADMIN, y la regla no admite excepción para nadie.
 */
const PERM_APROBAR = ['aprobar_ordenes_compra', 'aprobar_ordenes_compra_sin_tope'] as const
const PERM_RECIBIR = 'recibir_ordenes_compra'

/** Traduce al español los errores que vienen de la BD en una recepción o aprobación. */
function traducirError(msg: string): string {
  if (msg.includes('row-level security')) return SIN_PERMISO
  // Las excepciones del trigger y del RPC ya vienen con un texto para el usuario.
  if (msg.includes('no puede aprobarla')) return msg
  if (msg.includes('requiere el permiso')) return msg
  if (msg.includes('se pasa del pedido')) return msg
  if (msg.includes('oc_recepcion_items_motivo')) return 'Si rechazas cantidad, escribe el motivo del rechazo.'
  if (msg.includes('oc_recepcion_items_algo')) return 'Cada línea debe traer cantidad recibida o cantidad rechazada.'
  if (msg.includes('movimientos_compra_exige_oc')) return 'Una entrada marcada como compra necesita su orden de compra.'
  return msg
}

export async function crearOC(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso('crear_ordenes_compra')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const proveedor_id = String(formData.get('proveedor_id') ?? '')
  if (!proveedor_id) return { error: 'Selecciona un proveedor.' }

  const periodoStr = String(formData.get('periodo') ?? '')
  const periodo = periodoStr ? `${periodoStr}-01` : new Date().toISOString().slice(0, 8) + '01'
  const fecha_entrega = String(formData.get('fecha_entrega') ?? '') || null
  const observaciones = String(formData.get('observaciones') ?? '').trim() || null

  const productos = formData.getAll('item_producto').map(String)
  const cantidades = formData.getAll('item_cantidad').map(v => Number(v))
  const precios = formData.getAll('item_precio').map(v => Number(v))

  const items = productos
    .map((producto_id, i) => ({ producto_id, cantidad_ped: cantidades[i], precio_unit: precios[i] }))
    .filter(it => it.producto_id && Number.isFinite(it.cantidad_ped) && it.cantidad_ped > 0 && Number.isFinite(it.precio_unit))

  if (items.length === 0) return { error: 'Agrega al menos un ítem válido a la orden.' }

  const valor_total = items.reduce((a, it) => a + it.cantidad_ped * it.precio_unit, 0)

  // Numeración automática robusta: OC-YYYYMM-NNN a partir del MÁXIMO consecutivo
  // del período (no del conteo, que colisiona al anular/borrar), con reintento
  // ante creaciones concurrentes.
  const prefijo = `OC-${periodoStr.replace('-', '') || new Date().toISOString().slice(0, 7).replace('-', '')}-`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: previas } = await sb.from('ordenes_compra').select('numero_oc').like('numero_oc', prefijo + '%')
  let consecutivo = 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((previas ?? []) as any[])) {
    const mm = String(r.numero_oc).match(/-(\d+)$/)
    if (mm) { const n = parseInt(mm[1], 10); if (n >= consecutivo) consecutivo = n + 1 }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let oc: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let error: any = null
  for (let intento = 0; intento < 15; intento++) {
    const numero_oc = `${prefijo}${String(consecutivo).padStart(3, '0')}`
    const res = await sb.from('ordenes_compra').insert({
      numero_oc, proveedor_id, periodo, fecha_entrega, observaciones,
      estado: 'BORRADOR', valor_total, creado_por: user.id,
    }).select('id').single()
    if (!res.error) { oc = res.data; break }
    const msg = String(res.error.message ?? '')
    if (res.error.code === '23505' || msg.includes('duplicate key')) { consecutivo++; continue }
    error = res.error; break
  }

  if (error || !oc) {
    if ((error?.message ?? '').includes('row-level security')) return { error: 'No tienes permisos (requiere Admin o Coord. Compras).' }
    return { error: 'No se pudo crear la orden: ' + (error?.message ?? 'no se pudo asignar número, intenta de nuevo') }
  }

  const itemsInsert = items.map(it => ({ oc_id: oc.id, producto_id: it.producto_id, cantidad_ped: it.cantidad_ped, precio_unit: it.precio_unit }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (supabase as any).from('oc_items').insert(itemsInsert)
  if (itemsErr) return { error: 'Orden creada pero falló el guardado de ítems: ' + itemsErr.message }

  revalidatePath('/ordenes-compra')
  redirect('/ordenes-compra')
}

export async function anularOC(formData: FormData): Promise<void> {
  if (await faltaPermiso('crear_ordenes_compra')) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('ordenes_compra').update({ estado: 'ANULADA' }).eq('id', id)
  revalidatePath('/ordenes-compra')
}

// ─── Flujo de proceso + trazabilidad ─────────────────────────────────────────

const TRANSICIONES: Record<string, string[]> = {
  BORRADOR: ['APROBADA', 'ANULADA'],
  APROBADA: ['ENVIADA', 'ANULADA'],
  ENVIADA: ['ANULADA'],
  PARCIAL: ['ANULADA'],
  COMPLETA: [],
  ANULADA: [],
}

/** Avanza el estado de la OC (aprobar, marcar comprada/enviada, anular). */
export async function avanzarEstadoOC(id: string, nuevoEstado: string, comentario?: string): Promise<ActionResult> {
  // Aprobar es la única transición que no le corresponde a compras.
  const falta = nuevoEstado === 'APROBADA'
    ? await faltaPermiso(...PERM_APROBAR)
    : await faltaPermiso('crear_ordenes_compra')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: oc } = await sb.from('ordenes_compra').select('estado').eq('id', id).single()
  if (!oc) return { error: 'Orden no encontrada.' }
  if (!(TRANSICIONES[oc.estado] ?? []).includes(nuevoEstado)) {
    return { error: `No se puede pasar de ${oc.estado} a ${nuevoEstado}.` }
  }

  const patch: Record<string, unknown> = { estado: nuevoEstado }
  const ahora = new Date().toISOString()
  if (nuevoEstado === 'APROBADA') { patch.fecha_aprobacion = ahora; patch.aprobado_por = user.id }
  if (nuevoEstado === 'ENVIADA') patch.fecha_envio = ahora

  const { error } = await sb.from('ordenes_compra').update(patch).eq('id', id)
  if (error) return { error: traducirError(error.message) }
  if (comentario?.trim()) await insertarComentario(sb, id, user.id, comentario.trim())

  revalidatePath('/ordenes-compra')
  revalidatePath(`/ordenes-compra/${id}`)
  return {}
}

/** Una línea de la entrega: lo que llegó y lo que se rechazó de un ítem. */
export interface LineaEntrega {
  ocItemId: string
  cantidad: number
  cantidadRechazada?: number
  motivoRechazo?: string
}

export interface EntregaInput {
  fecha?: string | null
  remision?: string | null
  ubicacionId?: string | null
  observacion?: string | null
  lineas: LineaEntrega[]
}

/**
 * Registra UNA ENTREGA del proveedor contra la orden.
 *
 * Antes (`registrarRecepcionOC`) esto pisaba `oc_items.cantidad_rec` como un
 * acumulado: si llegaban 50 y después 30, el campo quedaba en 80 sin rastro de
 * que fueran dos entregas en dos fechas, y el movimiento de inventario se
 * registraba en una llamada aparte que podía fallar y dejar el stock desalineado.
 *
 * Ahora todo lo hace `oc_registrar_recepcion` en una sola transacción: crea la
 * entrega, sus líneas, los movimientos de ENTRADA con `oc_id` y ubicación, suma
 * el stock y recalcula el estado. O pasa todo, o no pasa nada.
 */
export async function registrarEntregaOC(id: string, entrada: EntregaInput): Promise<ActionResult> {
  const falta = await faltaPermiso(PERM_RECIBIR)
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const lineas = (entrada.lineas ?? [])
    .map(l => ({
      oc_item_id: l.ocItemId,
      cantidad: Number(l.cantidad) || 0,
      cantidad_rechazada: Number(l.cantidadRechazada) || 0,
      motivo_rechazo: l.motivoRechazo?.trim() || null,
    }))
    .filter(l => l.oc_item_id && (l.cantidad > 0 || l.cantidad_rechazada > 0))

  if (lineas.length === 0) return { error: 'Indica al menos un producto con cantidad recibida o rechazada.' }

  const sinMotivo = lineas.find(l => l.cantidad_rechazada > 0 && !l.motivo_rechazo)
  if (sinMotivo) return { error: 'Si rechazas cantidad, escribe el motivo del rechazo.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('oc_registrar_recepcion', {
    p_oc: id,
    p_items: lineas,
    p_fecha: entrada.fecha || null,
    p_remision: entrada.remision?.trim() || null,
    p_ubicacion: entrada.ubicacionId || null,
    p_observacion: entrada.observacion?.trim() || null,
  })
  if (error) return { error: traducirError(error.message) }

  revalidatePath('/ordenes-compra')
  revalidatePath(`/ordenes-compra/${id}`)
  revalidatePath('/stock')
  revalidatePath('/movimientos')
  return {}
}

/** Agrega un comentario a la trazabilidad de la OC. */
export async function comentarOC(id: string, texto: string): Promise<ActionResult> {
  // Comentar lo puede hacer cualquiera que participe en la orden, incluida la
  // bodega que la recibe: la RLS de `oc_eventos` acepta los cuatro permisos.
  const falta = await faltaPermiso('crear_ordenes_compra', 'ver_ordenes_compra', ...PERM_APROBAR, PERM_RECIBIR)
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  if (!texto.trim()) return { error: 'Escribe un comentario.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const err = await insertarComentario(sb, id, user.id, texto.trim())
  if (err) return { error: err }
  revalidatePath(`/ordenes-compra/${id}`)
  return {}
}

/**
 * Reemplaza los ítems de una OC en BORRADOR (agregar / editar / quitar) y
 * recalcula el valor total. Hace un diff para no ensuciar la trazabilidad:
 * solo dispara eventos de los ítems que realmente cambian.
 */
export async function actualizarItemsOC(
  id: string,
  lineas: { id?: string; producto_id: string; cantidad: number; precio: number }[],
  proveedorId?: string,
): Promise<ActionResult> {
  const falta = await faltaPermiso('crear_ordenes_compra')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: oc } = await sb.from('ordenes_compra').select('estado').eq('id', id).single()
  if (!oc) return { error: 'Orden no encontrada.' }
  if (oc.estado !== 'BORRADOR') return { error: 'Solo se pueden editar los ítems de una orden en borrador.' }

  const validas = lineas.filter(l => l.producto_id && Number.isFinite(l.cantidad) && l.cantidad > 0 && Number.isFinite(l.precio) && l.precio >= 0)
  if (validas.length === 0) return { error: 'Agrega al menos un ítem válido (producto, cantidad y precio).' }

  const { data: existentes } = await sb.from('oc_items').select('id, producto_id, cantidad_ped, precio_unit').eq('oc_id', id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapExist = new Map<string, any>(((existentes ?? []) as any[]).map(x => [x.id, x]))
  const mantener = new Set(validas.filter(l => l.id && mapExist.has(l.id)).map(l => l.id as string))

  // Eliminar los que ya no están
  const aEliminar = [...mapExist.keys()].filter(x => !mantener.has(x))
  if (aEliminar.length) {
    const { error } = await sb.from('oc_items').delete().in('id', aEliminar)
    if (error) return { error: traducirItems(error.message) }
  }

  // Actualizar existentes (solo si cambió algo) e insertar nuevos
  for (const l of validas) {
    if (l.id && mapExist.has(l.id)) {
      const prev = mapExist.get(l.id)
      if (Number(prev.cantidad_ped) === l.cantidad && Number(prev.precio_unit) === l.precio && prev.producto_id === l.producto_id) continue
      const { error } = await sb.from('oc_items').update({ producto_id: l.producto_id, cantidad_ped: l.cantidad, precio_unit: l.precio }).eq('id', l.id)
      if (error) return { error: traducirItems(error.message) }
    } else {
      const { error } = await sb.from('oc_items').insert({ oc_id: id, producto_id: l.producto_id, cantidad_ped: l.cantidad, precio_unit: l.precio })
      if (error) return { error: traducirItems(error.message) }
    }
  }

  const valor_total = validas.reduce((a, l) => a + l.cantidad * l.precio, 0)
  const patch: Record<string, unknown> = { valor_total }
  if (proveedorId) patch.proveedor_id = proveedorId
  await sb.from('ordenes_compra').update(patch).eq('id', id)

  revalidatePath('/ordenes-compra')
  revalidatePath(`/ordenes-compra/${id}`)
  return {}
}

function traducirItems(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere Admin o Coord. Compras).'
  return 'No se pudieron guardar los ítems: ' + msg
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertarComentario(sb: any, ocId: string, userId: string, texto: string): Promise<string | undefined> {
  const { data: u } = await sb.from('usuarios').select('nombre, email').eq('id', userId).single()
  const { error } = await sb.from('oc_eventos').insert({
    oc_id: ocId, tipo: 'COMENTARIO', descripcion: texto,
    usuario_id: userId, usuario_email: u?.email ?? null, usuario_nombre: u?.nombre ?? null,
  })
  if (error) return error.message.includes('row-level security') ? 'Sin permisos para comentar.' : error.message
}
