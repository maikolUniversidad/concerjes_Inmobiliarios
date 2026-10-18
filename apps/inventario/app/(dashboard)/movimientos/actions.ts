'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { TipoMovimiento } from '@/lib/types/database'
import { faltaPermiso } from '@/lib/permisos-server'

export interface ActionResult { error?: string }

export async function registrarMovimiento(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso('crear_movimientos')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const producto_id = String(formData.get('producto_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '') as TipoMovimiento
  const cantidad = Number(formData.get('cantidad'))
  const sede_id = String(formData.get('sede_id') ?? '') || null
  const ubicacion_id = String(formData.get('ubicacion_id') ?? '') || null
  const observacion = String(formData.get('observacion') ?? '').trim() || null

  if (!producto_id) return { error: 'Selecciona un producto.' }
  if (!['ENTRADA', 'SALIDA', 'DEVOLUCION', 'AJUSTE', 'TRASLADO'].includes(tipo)) return { error: 'Tipo de movimiento inválido.' }
  if (!Number.isFinite(cantidad) || cantidad <= 0) return { error: 'La cantidad debe ser mayor que cero.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('registrar_movimiento', {
    p_producto: producto_id,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_sede: sede_id,
    p_observacion: observacion,
    p_ubicacion: ubicacion_id,
  })

  if (error) {
    if (error.message.includes('row-level security') || error.message.includes('permission'))
      return { error: 'No tienes permisos para registrar movimientos.' }
    return { error: 'No se pudo registrar el movimiento: ' + error.message }
  }

  revalidatePath('/movimientos')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
  redirect('/movimientos')
}

/**
 * De dónde viene una entrada. No toda entrada es una compra: también entra lo
 * que vuelve de producción, del reembasado o de otra área. Solo COMPRA exige
 * orden de compra, y eso lo verifica además la restricción
 * `movimientos_compra_exige_oc` en la base.
 */
export const ORIGENES_ENTRADA = [
  'COMPRA', 'PRODUCCION', 'REEMBASADO', 'TRASLADO_INTERNO', 'DEVOLUCION_SEDE', 'AJUSTE', 'OTRO',
] as const
export type OrigenMovimiento = (typeof ORIGENES_ENTRADA)[number]

export interface MovItem {
  tipo: TipoMovimiento
  producto_id: string
  cantidad: number
  sede_id: string | null
  ubicacion_id: string | null
  observacion: string | null
  origen?: OrigenMovimiento | null
  oc_id?: string | null
}

/**
 * Una entrada de compra tiene que decir contra qué orden entró. Es la regla que
 * cierra el hueco de la fase 1: hasta ahora ninguna de las entradas registradas
 * tenía orden detrás, así que no había forma de saber qué se compró ni a quién.
 */
function faltaOrdenDeCompra(it: MovItem): boolean {
  return it.tipo === 'ENTRADA' && it.origen === 'COMPRA' && !it.oc_id
}

/** Registra VARIOS movimientos en lote (uno por fila). */
export async function registrarMovimientos(items: MovItem[]): Promise<{ error?: string; ok?: number }> {
  const falta = await faltaPermiso('crear_movimientos')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const validos = items.filter(it =>
    it.producto_id &&
    ['ENTRADA', 'SALIDA', 'DEVOLUCION', 'AJUSTE', 'TRASLADO'].includes(it.tipo) &&
    Number.isFinite(it.cantidad) && it.cantidad > 0,
  )
  if (validos.length === 0) return { error: 'Agrega al menos un movimiento válido (producto y cantidad > 0).' }

  const sinOrden = validos.findIndex(faltaOrdenDeCompra)
  if (sinOrden >= 0) {
    return { error: `La fila ${sinOrden + 1} es una entrada de compra: elige la orden de compra contra la que entró.` }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let ok = 0
  for (const it of validos) {
    // Las entradas van por `registrar_entrada`, que sí puede guardar el origen
    // y la orden de compra. El resto sigue por `registrar_movimiento`.
    const { error } = it.tipo === 'ENTRADA'
      ? await sb.rpc('registrar_entrada', {
          p_producto: it.producto_id, p_cantidad: it.cantidad,
          p_origen: it.oc_id ? 'COMPRA' : (it.origen || null), p_oc: it.oc_id || null,
          p_ubicacion: it.ubicacion_id, p_sede: it.sede_id, p_observacion: it.observacion,
        })
      : await sb.rpc('registrar_movimiento', {
          p_producto: it.producto_id, p_tipo: it.tipo, p_cantidad: it.cantidad,
          p_sede: it.sede_id, p_observacion: it.observacion, p_ubicacion: it.ubicacion_id,
        })
    if (error) {
      const msg = error.message.includes('row-level security') || error.message.includes('permission')
        ? 'No tienes permisos para registrar movimientos.'
        : error.message
      return { error: `Se registraron ${ok} de ${validos.length}. Falló en la fila ${ok + 1}: ${msg}`, ok }
    }
    ok++
  }

  revalidatePath('/movimientos')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
  return { ok }
}

// ── Borradores de movimientos ────────────────────────────────────────────────
export interface BorradorInput {
  id?: string
  nombre: string
  items: MovItem[]
  responsables: string[]
}

/** Crea o actualiza un borrador de movimientos con sus ítems y responsables. */
export async function guardarBorrador(input: BorradorInput): Promise<{ error?: string; id?: string }> {
  const falta = await faltaPermiso('crear_movimientos')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  let borradorId = input.id
  if (borradorId) {
    const { error } = await sb.from('movimiento_borradores').update({ nombre: input.nombre.trim() || null }).eq('id', borradorId)
    if (error) return { error: 'No se pudo guardar: ' + error.message }
  } else {
    const { data, error } = await sb.from('movimiento_borradores')
      .insert({ nombre: input.nombre.trim() || null, creado_por: user.id }).select('id').single()
    if (error) return { error: 'No se pudo crear el borrador: ' + error.message }
    borradorId = data.id
  }

  // Reemplaza ítems
  await sb.from('movimiento_borrador_items').delete().eq('borrador_id', borradorId)
  const itemsRows = input.items.map((it, i) => ({
    borrador_id: borradorId, tipo: it.tipo, producto_id: it.producto_id || null,
    cantidad: it.cantidad, sede_id: it.sede_id, ubicacion_id: it.ubicacion_id, observacion: it.observacion, orden: i,
  }))
  if (itemsRows.length) {
    const { error } = await sb.from('movimiento_borrador_items').insert(itemsRows)
    if (error) return { error: 'No se pudieron guardar los ítems: ' + error.message }
  }

  // Reemplaza responsables
  await sb.from('movimiento_borrador_responsables').delete().eq('borrador_id', borradorId)
  const resp = [...new Set(input.responsables.filter(Boolean))]
  if (resp.length) {
    await sb.from('movimiento_borrador_responsables').insert(resp.map(usuario_id => ({ borrador_id: borradorId, usuario_id })))
  }

  revalidatePath('/movimientos/nuevo')
  return { id: borradorId }
}

export async function eliminarBorrador(id: string): Promise<{ error?: string }> {
  const falta = await faltaPermiso('crear_movimientos')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('movimiento_borradores').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/movimientos/nuevo')
  return {}
}

/** Registra todos los ítems del borrador como movimientos y lo elimina. */
export async function registrarDesdeBorrador(id: string): Promise<{ error?: string; ok?: number }> {
  const falta = await faltaPermiso('crear_movimientos')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: items } = await sb.from('movimiento_borrador_items')
    .select('tipo, producto_id, cantidad, sede_id, ubicacion_id, observacion').eq('borrador_id', id).order('orden')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: MovItem[] = ((items ?? []) as any[]).map(it => ({
    tipo: it.tipo, producto_id: it.producto_id, cantidad: Number(it.cantidad),
    sede_id: it.sede_id, ubicacion_id: it.ubicacion_id, observacion: it.observacion,
  }))
  const r = await registrarMovimientos(payload)
  if (r.error) return r
  await sb.from('movimiento_borradores').delete().eq('id', id)
  revalidatePath('/movimientos/nuevo')
  return { ok: r.ok }
}

/**
 * Elimina un movimiento registrado por error y deshace su efecto en el stock.
 * La lógica vive en el RPC `eliminar_movimiento` para que borrado y stock vayan
 * en la misma transacción. El AJUSTE no se puede revertir solo (fijaba un valor
 * absoluto): se borra el registro y el RPC lo avisa en el mensaje.
 */
export async function eliminarMovimiento(id: string, revertirStock = true): Promise<{ error?: string; mensaje?: string }> {
  const falta = await faltaPermiso('eliminar_movimientos')
  if (falta) return { error: falta }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }
  if (!id) return { error: 'Movimiento no indicado.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('eliminar_movimiento', {
    p_mov: id, p_revertir: revertirStock,
  })
  if (error) {
    return { error: error.message.includes('permiso') ? error.message : 'No se pudo eliminar el movimiento: ' + error.message }
  }

  revalidatePath('/movimientos'); revalidatePath('/stock'); revalidatePath('/dashboard')
  return { mensaje: (data as string) ?? 'Movimiento eliminado.' }
}
