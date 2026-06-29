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
