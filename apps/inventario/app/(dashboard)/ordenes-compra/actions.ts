'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult { error?: string }

export async function crearOC(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
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

  // Numeración automática: OC-YYYYMM-NNN
  const { count } = await supabase.from('ordenes_compra').select('*', { count: 'exact', head: true })
  const numero_oc = `OC-${periodoStr.replace('-', '') || new Date().toISOString().slice(0, 7).replace('-', '')}-${String((count ?? 0) + 1).padStart(3, '0')}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oc, error } = await (supabase as any).from('ordenes_compra').insert({
    numero_oc, proveedor_id, periodo, fecha_entrega, observaciones,
    estado: 'BORRADOR', valor_total, creado_por: user.id,
  }).select('id').single()

  if (error) {
    if (error.message.includes('row-level security')) return { error: 'No tienes permisos (requiere Admin o Coord. Compras).' }
    return { error: 'No se pudo crear la orden: ' + error.message }
  }

  const itemsInsert = items.map(it => ({ oc_id: oc.id, producto_id: it.producto_id, cantidad_ped: it.cantidad_ped, precio_unit: it.precio_unit }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (supabase as any).from('oc_items').insert(itemsInsert)
  if (itemsErr) return { error: 'Orden creada pero falló el guardado de ítems: ' + itemsErr.message }

  revalidatePath('/ordenes-compra')
  redirect('/ordenes-compra')
}

export async function anularOC(formData: FormData): Promise<void> {
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
  if (error) {
    if (error.message.includes('row-level security')) return { error: 'No tienes permisos (requiere Admin o Coord. Compras).' }
    return { error: error.message }
  }
  if (comentario?.trim()) await insertarComentario(sb, id, user.id, comentario.trim())

  revalidatePath('/ordenes-compra')
  revalidatePath(`/ordenes-compra/${id}`)
  return {}
}

/** Registra recepción de ítems y ajusta el estado (PARCIAL/COMPLETA). */
export async function registrarRecepcionOC(
  id: string,
  recepciones: { itemId: string; cantidad: number }[],
  comentario?: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: items } = await sb.from('oc_items').select('id, cantidad_ped, cantidad_rec').eq('oc_id', id)
  if (!items || items.length === 0) return { error: 'La orden no tiene ítems.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapItems = new Map((items as any[]).map(it => [it.id, it]))
  for (const r of recepciones) {
    const it = mapItems.get(r.itemId)
    if (!it) continue
    const nuevo = Math.max(0, Math.min(Number(it.cantidad_ped), Number(r.cantidad)))
    if (nuevo === Number(it.cantidad_rec)) continue
    const { error } = await sb.from('oc_items').update({ cantidad_rec: nuevo }).eq('id', r.itemId)
    if (error) return { error: error.message }
    it.cantidad_rec = nuevo
  }

  // Recalcular estado
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr = Array.from(mapItems.values()) as any[]
  const algo = arr.some(it => Number(it.cantidad_rec) > 0)
  const todo = arr.every(it => Number(it.cantidad_rec) >= Number(it.cantidad_ped))
  const { data: ocAct } = await sb.from('ordenes_compra').select('estado').eq('id', id).single()
  const estadoActual = ocAct?.estado
  let nuevoEstado: string | null = null
  if (todo && estadoActual !== 'COMPLETA') nuevoEstado = 'COMPLETA'
  else if (algo && !todo && !['PARCIAL', 'COMPLETA'].includes(estadoActual)) nuevoEstado = 'PARCIAL'

  if (nuevoEstado) {
    const patch: Record<string, unknown> = { estado: nuevoEstado }
    if (nuevoEstado === 'COMPLETA') patch.fecha_recepcion = new Date().toISOString()
    await sb.from('ordenes_compra').update(patch).eq('id', id)
  }
  if (comentario?.trim()) await insertarComentario(sb, id, user.id, comentario.trim())

  revalidatePath('/ordenes-compra')
  revalidatePath(`/ordenes-compra/${id}`)
  return {}
}

/** Agrega un comentario a la trazabilidad de la OC. */
export async function comentarOC(id: string, texto: string): Promise<ActionResult> {
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
