'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult { error?: string; ok?: boolean; mensaje?: string }

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere Admin o Coord. Compras).'
  if (msg.includes('duplicate')) return 'Ese proveedor ya tiene precio para este producto.'
  return 'Operación fallida: ' + msg
}

/** Crea o actualiza el precio de un proveedor para un producto (matriz precios_proveedor). */
export async function guardarPrecio(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const producto_id = String(formData.get('producto_id') ?? '')
  const proveedor_id = String(formData.get('proveedor_id') ?? '')
  const precio = Number(formData.get('precio'))
  const fecha_cotiz = String(formData.get('fecha_cotiz') ?? '') || null
  const vigente = formData.get('vigente') === 'on'

  if (!producto_id || !proveedor_id) return { error: 'Selecciona producto y proveedor.' }
  if (!Number.isFinite(precio) || precio < 0) return { error: 'Ingresa un precio válido.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('precios_proveedor').upsert(
    { producto_id, proveedor_id, precio, fecha_cotiz, vigente },
    { onConflict: 'producto_id,proveedor_id' },
  )
  if (error) return { error: traducir(error.message) }

  revalidatePath('/comparador-precios')
  return { ok: true }
}

/** Elimina un precio de proveedor de la matriz. */
export async function eliminarPrecio(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('precios_proveedor').delete().eq('id', id)
  revalidatePath('/comparador-precios')
}

/**
 * Sincroniza la matriz precios_proveedor con los proveedores/precios que ya
 * están en la ficha de cada producto (proveedor_id/precio_lista y
 * proveedor2_id/precio_lista2). Deja la relación productos↔proveedores poblada
 * de inmediato, sin duplicar (upsert por producto+proveedor).
 */
export async function importarDesdeProductos(): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data: productos, error: readErr } = await supabase
    .from('productos')
    .select('id, proveedor_id, precio_lista, proveedor2_id, precio_lista2')
    .eq('activo', true)
  if (readErr) return { error: 'No se pudieron leer los productos: ' + readErr.message }

  // Deduplica por (producto, proveedor); el último gana.
  const mapa = new Map<string, { producto_id: string; proveedor_id: string; precio: number; vigente: boolean }>()
  for (const p of (productos ?? []) as {
    id: string; proveedor_id: string | null; precio_lista: number | null
    proveedor2_id: string | null; precio_lista2: number | null
  }[]) {
    if (p.proveedor_id && p.precio_lista != null) {
      mapa.set(`${p.id}:${p.proveedor_id}`, { producto_id: p.id, proveedor_id: p.proveedor_id, precio: p.precio_lista, vigente: true })
    }
    if (p.proveedor2_id && p.precio_lista2 != null) {
      mapa.set(`${p.id}:${p.proveedor2_id}`, { producto_id: p.id, proveedor_id: p.proveedor2_id, precio: p.precio_lista2, vigente: true })
    }
  }
  const filas = [...mapa.values()]
  if (filas.length === 0) return { ok: true, mensaje: 'No hay proveedores/precios en las fichas de productos para importar.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('precios_proveedor').upsert(filas, { onConflict: 'producto_id,proveedor_id' })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/comparador-precios')
  return { ok: true, mensaje: `Se sincronizaron ${filas.length} precios desde las fichas de productos.` }
}
