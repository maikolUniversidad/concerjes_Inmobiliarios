'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

async function sesion() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

// ── Crear orden de insumo a partir de la parametrización de una sede ──────────
export async function crearOrdenInsumo(input: {
  sede_id: string
  bodega_id?: string | null
  observacion?: string | null
  items: { producto_id: string; cantidad: number; maximo: number }[]
  responsables?: string[]
}): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo')) return { error: 'No tienes permiso para crear órdenes de insumo.' }

  if (!input.sede_id) return { error: 'Selecciona una sede.' }
  const items = (input.items ?? []).filter((it) => it.producto_id && Number.isFinite(it.cantidad) && it.cantidad > 0)
  if (items.length === 0) return { error: 'La orden no tiene productos con cantidad.' }

  const sb = supabase as DB
  const now = new Date()
  const periodo = now.toISOString().slice(0, 8) + '01'
  const { count } = await sb.from('ordenes_insumo').select('*', { count: 'exact', head: true })
  const numero = `OI-${now.toISOString().slice(0, 7).replace('-', '')}-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { data: orden, error } = await sb.from('ordenes_insumo').insert({
    numero, sede_id: input.sede_id, bodega_id: input.bodega_id || null,
    observacion: input.observacion?.trim() || null, periodo, estado: 'PENDIENTE', creado_por: user.id,
  }).select('id').single()

  if (error || !orden) {
    if ((error?.message ?? '').includes('row-level security')) return { error: 'No tienes permisos para crear órdenes.' }
    return { error: 'No se pudo crear la orden: ' + (error?.message ?? '') }
  }

  const itemsInsert = items.map((it) => ({
    orden_id: orden.id, producto_id: it.producto_id,
    cantidad_solicitada: it.cantidad, cantidad_maxima_ref: it.maximo ?? null,
    // El alistamiento arranca con lo solicitado: si hay menos, se baja a mano.
    cantidad_alistada: it.cantidad,
  }))
  const { error: itErr } = await sb.from('orden_insumo_items').insert(itemsInsert)
  if (itErr) return { error: 'Orden creada pero falló el guardado de ítems: ' + itErr.message }

  if (input.responsables?.length) {
    await sb.from('orden_insumo_responsables').insert(
      input.responsables.map((usuario_id) => ({ orden_id: orden.id, usuario_id })),
    )
  }

  revalidatePath('/ordenes-insumo')
  redirect(`/ordenes-insumo/${orden.id}`)
}

// ── Alistamiento: marcar/actualizar un ítem ──────────────────────────────────
export async function actualizarItemAlistamiento(
  ordenId: string, itemId: string, patch: { cantidad_alistada?: number; alistado?: boolean },
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('alistar_ordenes_insumo')) return { error: 'No tienes permiso para alistar.' }
  const sb = supabase as DB

  const upd: Record<string, unknown> = {}
  if (patch.cantidad_alistada !== undefined) upd.cantidad_alistada = Math.max(0, patch.cantidad_alistada)
  if (patch.alistado !== undefined) {
    upd.alistado = patch.alistado
    upd.alistado_por = patch.alistado ? user.id : null
    upd.alistado_at = patch.alistado ? new Date().toISOString() : null
  }
  const { error } = await sb.from('orden_insumo_items').update(upd).eq('id', itemId)
  if (error) return { error: error.message.includes('row-level security') ? 'Sin permisos.' : error.message }

  // Arranca el alistamiento en la cabecera si estaba PENDIENTE.
  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (orden?.estado === 'PENDIENTE') {
    await sb.from('ordenes_insumo').update({ estado: 'EN_ALISTAMIENTO', alistamiento_iniciado_at: new Date().toISOString() }).eq('id', ordenId)
  }

  // Si todos los ítems quedaron alistados → ALISTADO; si no, mantener EN_ALISTAMIENTO.
  const { data: items } = await sb.from('orden_insumo_items').select('alistado').eq('orden_id', ordenId)
  const todos = (items ?? []).length > 0 && (items as { alistado: boolean }[]).every((i) => i.alistado)
  const { data: est } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (est && !['DESPACHADO', 'ANULADA'].includes(est.estado)) {
    const nuevo = todos ? 'ALISTADO' : 'EN_ALISTAMIENTO'
    if (est.estado !== nuevo) {
      await sb.from('ordenes_insumo').update({ estado: nuevo, alistado_at: todos ? new Date().toISOString() : null }).eq('id', ordenId)
    }
  }

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  revalidatePath('/ordenes-insumo')
  return { ok: true }
}

// ── Responsables ─────────────────────────────────────────────────────────────
export async function asignarResponsable(ordenId: string, usuarioId: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const sb = supabase as DB
  const { error } = await sb.from('orden_insumo_responsables').insert({ orden_id: ordenId, usuario_id: usuarioId })
  if (error && !error.message.includes('duplicate')) return { error: error.message }
  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
}

export async function quitarResponsable(ordenId: string, usuarioId: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const sb = supabase as DB
  await sb.from('orden_insumo_responsables').delete().eq('orden_id', ordenId).eq('usuario_id', usuarioId)
  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
}

// ── Despacho: registra SALIDA de stock por ítem + guarda video + estado ───────
export async function despacharOrden(ordenId: string, videoPath: string, videoMime: string | null): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('alistar_ordenes_insumo')) return { error: 'No tienes permiso para despachar.' }
  const sb = supabase as DB

  if (!videoPath) return { error: 'Falta el video del despacho.' }

  const { data: orden } = await sb.from('ordenes_insumo').select('id, estado, sede_id, bodega_id').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (orden.estado === 'DESPACHADO') return { error: 'La orden ya fue despachada.' }
  if (orden.estado === 'ANULADA') return { error: 'La orden está anulada.' }

  const { data: items } = await sb.from('orden_insumo_items')
    .select('id, producto_id, cantidad_solicitada, cantidad_alistada, alistado')
    .eq('orden_id', ordenId)
  const lista = (items ?? []) as { id: string; producto_id: string; cantidad_solicitada: number; cantidad_alistada: number; alistado: boolean }[]
  const aDespachar = lista.filter((it) => it.alistado && Number(it.cantidad_alistada) > 0)
  if (aDespachar.length === 0) return { error: 'No hay ítems alistados con cantidad para despachar.' }

  // Registrar SALIDA de stock (traslado a la sede) por cada ítem alistado.
  let fallos = 0
  for (const it of aDespachar) {
    const { error } = await sb.rpc('registrar_movimiento', {
      p_producto: it.producto_id,
      p_tipo: 'SALIDA',
      p_cantidad: Number(it.cantidad_alistada),
      p_sede: orden.sede_id,
      p_observacion: `Despacho orden de insumo`,
      p_ubicacion: null,
    })
    if (error) fallos++
  }
  if (fallos === aDespachar.length) {
    return { error: 'No se pudo registrar la salida de stock (permisos o stock). No se despachó.' }
  }

  const { error: updErr } = await sb.from('ordenes_insumo').update({
    estado: 'DESPACHADO', despachado_por: user.id, despachado_at: new Date().toISOString(),
    video_path: videoPath, video_mime: videoMime,
  }).eq('id', ordenId)
  if (updErr) return { error: 'Salida registrada pero no se pudo cerrar la orden: ' + updErr.message }

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  revalidatePath('/ordenes-insumo')
  return { ok: true, error: fallos > 0 ? `Despachada con ${fallos} ítem(s) sin descontar stock.` : undefined }
}

export async function anularOrden(ordenId: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const sb = supabase as DB
  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (orden?.estado === 'DESPACHADO') return { error: 'No se puede anular una orden despachada.' }
  const { error } = await sb.from('ordenes_insumo').update({ estado: 'ANULADA' }).eq('id', ordenId)
  if (error) return { error: error.message }
  revalidatePath('/ordenes-insumo')
  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
}
