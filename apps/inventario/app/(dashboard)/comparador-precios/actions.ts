'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { faltaPermiso } from '@/lib/permisos-server'

export interface ActionResult { error?: string; ok?: boolean; mensaje?: string }

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere Admin o Coord. Compras).'
  if (msg.includes('duplicate')) return 'Ese proveedor ya tiene precio para este producto.'
  return 'Operación fallida: ' + msg
}

/** Crea o actualiza el precio de un proveedor para un producto (matriz precios_proveedor). */
export async function guardarPrecio(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso('editar_proveedores')
  if (falta) return { error: falta }

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
  if (await faltaPermiso('editar_proveedores')) return

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
 * Completa la matriz precios_proveedor con el proveedor/precio que ya está en
 * la ficha del producto (proveedor_id/precio_lista y proveedor2_id/precio_lista2),
 * SOLO para los productos que aquí no tienen ningún proveedor todavía.
 *
 * Deliberadamente deja fuera los productos que ya tienen proveedores en la
 * matriz y cuya ficha nombra otro distinto (78 medidos en oct-2026). Para esos
 * la ficha y el comparador discrepan: sincronizar no corregiría nada, agregaría
 * un tercer proveedor más barato que nadie cotizó y que se llevaría la insignia
 * de "mejor precio" — y nueve de ellos cuelgan de CAJA MENOR, que es una compra
 * de contado, no un proveedor. Ver docs/modulo-compras.md § 13.
 */
export async function importarDesdeProductos(): Promise<ActionResult> {
  const falta = await faltaPermiso('editar_proveedores')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // Paginado: la importación debe recorrer el catálogo COMPLETO; sin esto solo
  // se importaban los precios de los primeros 1.000 productos.
  let productos: unknown[]
  try {
    productos = await traerTodo((desde, hasta) => supabase
      .from('productos')
      .select('id, proveedor_id, precio_lista, proveedor2_id, precio_lista2, precios_proveedor(proveedor_id)')
      .eq('activo', true)
      .order('id')
      .range(desde, hasta))
  } catch (e) {
    return { error: 'No se pudieron leer los productos: ' + (e instanceof Error ? e.message : String(e)) }
  }

  // Deduplica por (producto, proveedor); el último gana.
  const mapa = new Map<string, { producto_id: string; proveedor_id: string; precio: number; vigente: boolean }>()
  let omitidos = 0
  for (const p of productos as {
    id: string; proveedor_id: string | null; precio_lista: number | null
    proveedor2_id: string | null; precio_lista2: number | null
    precios_proveedor: { proveedor_id: string }[] | null
  }[]) {
    const tieneFicha = (p.proveedor_id && (p.precio_lista ?? 0) > 0) || (p.proveedor2_id && (p.precio_lista2 ?? 0) > 0)
    if ((p.precios_proveedor ?? []).length > 0) {
      // Ya tiene proveedor en el comparador: si la ficha nombra otro, es una
      // discrepancia por revisar a mano, no un hueco por rellenar.
      if (tieneFicha && !(p.precios_proveedor ?? []).some((x) => x.proveedor_id === p.proveedor_id)) omitidos++
      continue
    }
    // Precio 0 no se importa: ganaría la insignia de "mejor precio" y dejaría
    // el ahorro potencial sin sentido. Queda para asignarlo a mano.
    if (p.proveedor_id && (p.precio_lista ?? 0) > 0) {
      mapa.set(`${p.id}:${p.proveedor_id}`, { producto_id: p.id, proveedor_id: p.proveedor_id, precio: p.precio_lista as number, vigente: true })
    }
    if (p.proveedor2_id && (p.precio_lista2 ?? 0) > 0) {
      mapa.set(`${p.id}:${p.proveedor2_id}`, { producto_id: p.id, proveedor_id: p.proveedor2_id, precio: p.precio_lista2 as number, vigente: true })
    }
  }
  const nota = omitidos > 0
    ? ` Se dejaron fuera ${omitidos} productos cuya ficha nombra un proveedor distinto al que ya tienen aquí: revísalos a mano.`
    : ''

  const filas = [...mapa.values()]
  if (filas.length === 0) return { ok: true, mensaje: 'Ningún producto sin proveedor tiene proveedor y precio en su ficha.' + nota }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('precios_proveedor').upsert(filas, { onConflict: 'producto_id,proveedor_id' })
  if (error) return { error: traducir(error.message) }

  revalidatePath('/comparador-precios')
  return { ok: true, mensaje: `Se completaron ${filas.length} precios desde las fichas de productos.` + nota }
}
