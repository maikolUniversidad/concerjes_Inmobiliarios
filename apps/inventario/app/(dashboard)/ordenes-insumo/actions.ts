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
  items: { producto_id: string; cantidad: number; maximo: number; es_adicional?: boolean }[]
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

  // Nace como PROPUESTA del coordinador de sede: BORRADOR hasta enviarla a revisión.
  const { data: orden, error } = await sb.from('ordenes_insumo').insert({
    numero, sede_id: input.sede_id, bodega_id: input.bodega_id || null,
    observacion: input.observacion?.trim() || null, periodo, estado: 'BORRADOR', creado_por: user.id,
  }).select('id').single()

  if (error || !orden) {
    if ((error?.message ?? '').includes('row-level security')) return { error: 'No tienes permisos para crear órdenes.' }
    return { error: 'No se pudo crear la orden: ' + (error?.message ?? '') }
  }

  const itemsInsert = items.map((it) => ({
    orden_id: orden.id, producto_id: it.producto_id,
    cantidad_solicitada: it.cantidad, cantidad_maxima_ref: it.maximo ?? null,
    // Adicional = pedido fuera de la parametrización de la sede (sin tope).
    es_adicional: !!it.es_adicional,
    // El alistamiento arranca con lo solicitado: si hay menos, se baja a mano.
    cantidad_alistada: it.cantidad,
  }))
  const { error: itErr } = await sb.from('orden_insumo_items').insert(itemsInsert)
  if (itErr) return { error: 'Orden creada pero falló el guardado de ítems: ' + itErr.message }

  // El responsable es quien sube la orden (+ cualquiera que se pase explícitamente).
  const responsables = Array.from(new Set([user.id, ...(input.responsables ?? [])]))
  await sb.from('orden_insumo_responsables').insert(
    responsables.map((usuario_id) => ({ orden_id: orden.id, usuario_id })),
  )

  await sb.rpc('oi_evento', {
    p_orden: orden.id, p_tipo: 'CREACION',
    p_mensaje: `Propuesta creada con ${items.length} producto(s).`,
    p_nue: 'BORRADOR',
  })

  revalidatePath('/ordenes-insumo')
  redirect(`/ordenes-insumo/${orden.id}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// FLUJO DE APROBACIÓN (coordinador de sede ⇄ central)
// ═══════════════════════════════════════════════════════════════════════════

/** Estados en los que el coordinador todavía puede editar su propuesta. */
const EDITABLES = ['BORRADOR', 'CAMBIOS_SOLICITADOS']

/** El coordinador ajusta la cantidad propuesta de un ítem (antes de aprobar). */
export async function actualizarItemSolicitado(
  ordenId: string, itemId: string, cantidad: number,
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo')) return { error: 'No tienes permiso para editar la propuesta.' }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!EDITABLES.includes(orden.estado)) return { error: 'La orden ya no es editable (está en revisión o aprobada).' }

  const cant = Math.max(0, Number(cantidad) || 0)
  // Se captura el valor anterior para dejar el cambio en la trazabilidad.
  const { data: antes } = await sb.from('orden_insumo_items')
    .select('cantidad_solicitada, producto:productos ( nombre_estandar )').eq('id', itemId).single()

  const { error } = await sb.from('orden_insumo_items')
    .update({ cantidad_solicitada: cant, cantidad_alistada: cant })
    .eq('id', itemId)
  if (error) return { error: error.message }

  // Quién modificó qué queda registrado (oi_evento captura al usuario).
  const prod = antes?.producto?.nombre_estandar ?? 'producto'
  if (antes && Number(antes.cantidad_solicitada) !== cant) {
    await sb.rpc('oi_evento', {
      p_orden: ordenId, p_tipo: 'AJUSTE',
      p_mensaje: `Ajustó «${prod}»: ${antes.cantidad_solicitada} → ${cant}`,
      p_detalle: { item_id: itemId, antes: antes.cantidad_solicitada, despues: cant },
    })
  }

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
}

/** Coordinador → envía la propuesta a la central para revisión. */
export async function enviarARevision(ordenId: string, mensaje?: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo')) return { error: 'No tienes permiso.' }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!EDITABLES.includes(orden.estado)) return { error: 'Esta orden ya fue enviada o aprobada.' }

  const { error } = await sb.from('ordenes_insumo')
    .update({ estado: 'EN_REVISION', enviado_revision_at: new Date().toISOString() })
    .eq('id', ordenId)
  if (error) return { error: error.message }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'ENVIO_REVISION',
    p_mensaje: mensaje?.trim() || 'Propuesta enviada a la central para revisión.',
    p_ant: orden.estado, p_nue: 'EN_REVISION',
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo')
  return { ok: true }
}

/** Central → pide cambios: la orden vuelve al coordinador. */
export async function solicitarCambios(ordenId: string, mensaje: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('aprobar_ordenes_insumo')) return { error: 'Solo la central puede solicitar cambios.' }
  if (!mensaje?.trim()) return { error: 'Escribe qué cambios se requieren.' }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (orden.estado !== 'EN_REVISION') return { error: 'Solo se piden cambios sobre órdenes en revisión.' }

  const { error } = await sb.from('ordenes_insumo').update({ estado: 'CAMBIOS_SOLICITADOS' }).eq('id', ordenId)
  if (error) return { error: error.message }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'CAMBIOS_SOLICITADOS', p_mensaje: mensaje.trim(),
    p_ant: 'EN_REVISION', p_nue: 'CAMBIOS_SOLICITADOS',
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo')
  return { ok: true }
}

/**
 * Aprobación a dos manos: firman el solicitante (supervisor de la sede que la
 * propuso) y el coordinador de conserjes. La orden solo pasa a Alistamiento
 * cuando existen AMBOS vistos buenos.
 *
 * El lado que firma se deduce del usuario: si creó la orden firma como
 * solicitante; si no, firma como coordinador (requiere aprobar_ordenes_insumo).
 */
export async function aprobarOrden(ordenId: string, mensaje?: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo')
    .select('estado, creado_por, aprobado_solicitante_at, aprobado_coordinador_at')
    .eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (orden.estado !== 'EN_REVISION') return { error: 'Solo se aprueban órdenes en revisión.' }

  const esSolicitante = orden.creado_por === user.id
  const lado: 'SOLICITANTE' | 'COORDINADOR' = esSolicitante ? 'SOLICITANTE' : 'COORDINADOR'
  if (!esSolicitante && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'Solo el coordinador de conserjes o quien solicitó pueden aprobar.' }
  }

  const ahora = new Date().toISOString()
  const patch: Record<string, unknown> = esSolicitante
    ? { aprobado_solicitante_por: user.id, aprobado_solicitante_at: ahora }
    : { aprobado_coordinador_por: user.id, aprobado_coordinador_at: ahora }

  // ¿Con esta firma quedan las dos? Solo entonces pasa a alistamiento.
  const otraFirma = esSolicitante ? orden.aprobado_coordinador_at : orden.aprobado_solicitante_at
  const completa = Boolean(otraFirma)
  if (completa) Object.assign(patch, { estado: 'APROBADA', aprobado_por: user.id, aprobado_at: ahora })

  const { error } = await sb.from('ordenes_insumo').update(patch).eq('id', ordenId)
  if (error) return { error: error.message }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'APROBACION',
    p_mensaje: mensaje?.trim() || (completa
      ? `Visto bueno de ${lado === 'SOLICITANTE' ? 'quien solicitó' : 'el coordinador'}. Aprobada por ambas partes: pasa a alistamiento.`
      : `Visto bueno de ${lado === 'SOLICITANTE' ? 'quien solicitó' : 'el coordinador'}. Falta la otra firma para aprobar.`),
    p_ant: 'EN_REVISION', p_nue: completa ? 'APROBADA' : 'EN_REVISION',
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  return { ok: true }
}

/**
 * Recibido en sede: lo confirma el supervisor del contrato (mismo grupo de
 * contrato que la sede de la orden). Cierra el proceso.
 */
export async function confirmarRecepcion(ordenId: string, observacion?: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('recibir_ordenes_insumo')) return { error: 'No tienes permiso para dar el recibido.' }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (orden.estado !== 'DESPACHADO') return { error: 'Solo se recibe una orden ya enviada.' }

  // Solo el supervisor de ESE contrato puede recibir.
  const { data: delGrupo } = await sb.rpc('oi_es_del_grupo', { p_orden: ordenId })
  if (delGrupo === false) return { error: 'Solo el supervisor del contrato de esa sede puede dar el recibido.' }

  const { error } = await sb.from('ordenes_insumo')
    .update({
      estado: 'RECIBIDO', recibido_por: user.id,
      recibido_at: new Date().toISOString(), recibido_obs: observacion?.trim() || null,
    })
    .eq('id', ordenId)
  if (error) return { error: error.message }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'RECEPCION',
    p_mensaje: observacion?.trim() || 'Recibido en sede. Proceso finalizado.',
    p_ant: 'DESPACHADO', p_nue: 'RECIBIDO',
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  return { ok: true }
}

/** Comentario libre en la trazabilidad (ambas partes). */
export async function comentarOrden(ordenId: string, mensaje: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  if (!mensaje?.trim()) return { error: 'Escribe un mensaje.' }
  const sb = supabase as DB
  await sb.rpc('oi_evento', { p_orden: ordenId, p_tipo: 'COMENTARIO', p_mensaje: mensaje.trim() })
  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
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

  // El alistamiento SOLO existe una vez la orden fue aprobada por la central.
  const { data: previa } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!previa) return { error: 'Orden no encontrada.' }
  if (!['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO'].includes(previa.estado)) {
    return { error: 'La orden aún no está aprobada por la central.' }
  }

  const upd: Record<string, unknown> = {}
  if (patch.cantidad_alistada !== undefined) upd.cantidad_alistada = Math.max(0, patch.cantidad_alistada)
  if (patch.alistado !== undefined) {
    upd.alistado = patch.alistado
    upd.alistado_por = patch.alistado ? user.id : null
    upd.alistado_at = patch.alistado ? new Date().toISOString() : null
  }
  const { error } = await sb.from('orden_insumo_items').update(upd).eq('id', itemId)
  if (error) return { error: error.message.includes('row-level security') ? 'Sin permisos.' : error.message }

  // Arranca el alistamiento en la cabecera si la orden recién fue aprobada.
  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (orden?.estado === 'APROBADA') {
    await sb.from('ordenes_insumo').update({ estado: 'EN_ALISTAMIENTO', alistamiento_iniciado_at: new Date().toISOString() }).eq('id', ordenId)
    await sb.rpc('oi_evento', {
      p_orden: ordenId, p_tipo: 'ALISTAMIENTO', p_mensaje: 'Inició el alistamiento en bodega.',
      p_ant: 'APROBADA', p_nue: 'EN_ALISTAMIENTO',
    })
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
  revalidatePath('/alistamiento'); revalidatePath(`/alistamiento/${ordenId}`)
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
    estado: 'DESPACHADO' as const, despachado_por: user.id, despachado_at: new Date().toISOString(),
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
