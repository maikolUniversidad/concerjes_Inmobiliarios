'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { traerTodo } from '@/lib/supabase/paginado'
import { emitirNotificacion } from '@/lib/notificaciones'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

async function sesion() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

/** Nombre legible del usuario actual, para columnas "modificado por". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nombreUsuario(sb: any, userId: string): Promise<string> {
  const { data } = await sb.from('usuarios').select('nombre').eq('id', userId).single()
  return data?.nombre ?? 'Usuario'
}

/**
 * Calcula el siguiente número de orden del período a partir del MÁXIMO sufijo
 * existente (no del conteo): así los borrados no reutilizan un número ya usado.
 * Devuelve el entero del siguiente consecutivo (>= 1).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function siguienteConsecutivoOI(sb: any, prefijo: string): Promise<number> {
  const { data } = await sb.from('ordenes_insumo').select('numero').like('numero', prefijo + '%')
  let max = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((data ?? []) as any[])) {
    const m = String(r.numero).match(/-(\d+)$/)
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n }
  }
  return max + 1
}

/** true si el error de Postgres es una violación de la clave única del número. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function esColisionNumero(error: any): boolean {
  const msg = String(error?.message ?? '')
  return error?.code === '23505' || msg.includes('duplicate key') || msg.includes('ordenes_insumo_numero_key')
}

// ── Crear orden de insumo a partir de la parametrización de una sede ──────────
export async function crearOrdenInsumo(input: {
  sede_id: string
  bodega_id?: string | null
  observacion?: string | null
  items: { producto_id: string; cantidad: number; maximo: number; es_adicional?: boolean }[]
  responsables?: string[]
  fecha_entrega_pactada?: string | null
  urgente?: boolean
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
  const nowIso = now.toISOString()
  const periodo = now.toISOString().slice(0, 8) + '01'
  const prefijo = `OI-${now.toISOString().slice(0, 7).replace('-', '')}-`

  // Numeración robusta: se toma el MÁXIMO consecutivo del período (no el conteo,
  // que colisiona cuando se borran órdenes) y se reintenta si otro usuario tomó
  // el mismo número al mismo tiempo (creaciones concurrentes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orden: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let error: any = null
  let consecutivo = await siguienteConsecutivoOI(sb, prefijo)
  for (let intento = 0; intento < 15; intento++) {
    const numero = `${prefijo}${String(consecutivo).padStart(3, '0')}`
    // La orden nace en BORRADOR: se revisa/ajusta y luego se pasa a APROBADA con
    // el botón "Aprobar" (segunda instancia). Solo al aprobar entra a Alistamiento.
    const res = await sb.from('ordenes_insumo').insert({
      numero, sede_id: input.sede_id, bodega_id: input.bodega_id || null,
      observacion: input.observacion?.trim() || null, periodo, estado: 'BORRADOR', creado_por: user.id,
      fecha_entrega_pactada: input.fecha_entrega_pactada || null,
      urgente: !!input.urgente,
    }).select('id').single()
    if (!res.error) { orden = res.data; break }
    if (esColisionNumero(res.error)) { consecutivo++; continue }   // número tomado → probar el siguiente
    error = res.error; break
  }

  if (error || !orden) {
    if ((error?.message ?? '').includes('row-level security')) return { error: 'No tienes permisos para crear órdenes.' }
    if (esColisionNumero(error)) return { error: 'No se pudo asignar un número de orden libre. Intenta de nuevo.' }
    return { error: 'No se pudo crear la orden: ' + (error?.message ?? 'error desconocido') }
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

  // La observación del formulario queda en la trazabilidad como novedad inicial.
  const notaInicial = input.observacion?.trim()
  await sb.rpc('oi_evento', {
    p_orden: orden.id, p_tipo: 'CREACION',
    p_mensaje: `Orden creada en borrador con ${items.length} producto(s). Pendiente de aprobar.`
      + (notaInicial ? `\nNovedad: ${notaInicial}` : ''),
    p_nue: 'BORRADOR',
  })

  revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  redirect(`/ordenes-insumo/${orden.id}`)
}

/**
 * Aprueba un BORRADOR (segunda instancia): pasa la orden a APROBADA y la habilita
 * para Alistamiento en bodega. Un solo clic, con el botón "Aprobar".
 */
export async function aprobarBorrador(ordenId: string, mensaje?: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para aprobar órdenes.' }
  }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!['BORRADOR', 'CAMBIOS_SOLICITADOS'].includes(orden.estado)) {
    return { error: 'Solo se aprueba una orden en borrador.' }
  }

  // ¿Tiene al menos un producto con cantidad? Si no, no tiene sentido aprobar.
  const { count } = await sb.from('orden_insumo_items')
    .select('id', { count: 'exact', head: true }).eq('orden_id', ordenId).gt('cantidad_solicitada', 0)
  if (!count || count === 0) return { error: 'La orden no tiene productos con cantidad. Agrega productos antes de aprobar.' }

  const ahora = new Date().toISOString()
  const { error } = await sb.from('ordenes_insumo')
    .update({
      estado: 'APROBADA', aprobado_por: user.id, aprobado_at: ahora,
      aprobado_solicitante_por: user.id, aprobado_solicitante_at: ahora,
      aprobado_coordinador_por: user.id, aprobado_coordinador_at: ahora,
    })
    .eq('id', ordenId)
  if (error) {
    if (error.message.includes('row-level security')) return { error: 'No tienes permisos para aprobar.' }
    return { error: error.message }
  }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'APROBACION',
    p_mensaje: mensaje?.trim() || 'Orden aprobada. Disponible en Alistamiento de bodega.',
    p_ant: orden.estado, p_nue: 'APROBADA',
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  return { ok: true }
}

/**
 * Devuelve una orden ya existente a BORRADOR para volver a editarla. Solo desde
 * estados previos al despacho (aún no se movió inventario): APROBADA, PENDIENTE,
 * EN_ALISTAMIENTO, ALISTADO. Retira las aprobaciones y deja rastro.
 */
const REVERTIBLES_A_BORRADOR = ['APROBADA', 'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO', 'CAMBIOS_SOLICITADOS', 'EN_REVISION']

export async function devolverABorrador(ordenId: string, mensaje?: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para editar órdenes.' }
  }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (orden.estado === 'BORRADOR') return { error: 'La orden ya está en borrador.' }
  if (!REVERTIBLES_A_BORRADOR.includes(orden.estado)) {
    return { error: 'Esta orden ya fue despachada o cerrada; no se puede volver a borrador.' }
  }

  // Volver a borrador retira las aprobaciones y limpia marcas de alistamiento.
  const { error } = await sb.from('ordenes_insumo')
    .update({
      estado: 'BORRADOR', ...RESET_APROBACIONES,
      alistamiento_iniciado_at: null, alistado_at: null,
    })
    .eq('id', ordenId)
  if (error) {
    if (error.message.includes('row-level security')) return { error: 'No tienes permisos para editar esta orden.' }
    return { error: error.message }
  }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'APROBACION_RETIRADA',
    p_mensaje: mensaje?.trim() || `Orden devuelta a borrador (desde ${orden.estado}) para editarla de nuevo.`,
    p_ant: orden.estado, p_nue: 'BORRADOR',
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLUJO DE APROBACIÓN (coordinador de sede ⇄ central)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estados en los que aún se puede editar el pedido. También en revisión: si se
 * ajusta algo estando en revisión, se retiran las aprobaciones (ver más abajo).
 * Los estados APROBADA/EN_ALISTAMIENTO/ALISTADO también permiten editar (novedad
 * post-aprobación): el cambio queda en trazabilidad y genera notificación.
 */
const EDITABLES = ['BORRADOR', 'CAMBIOS_SOLICITADOS', 'EN_REVISION', 'APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO']
const ESTADOS_APROBADOS = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO']

/**
 * Cualquier cambio en la orden invalida las aprobaciones: las dos partes deben
 * volver a dar el visto bueno cuando ya no haya más cambios.
 */
const RESET_APROBACIONES = {
  aprobado_solicitante_por: null, aprobado_solicitante_at: null,
  aprobado_coordinador_por: null, aprobado_coordinador_at: null,
  aprobado_por: null, aprobado_at: null,
}

/**
 * Si el pedido se edita estando EN_REVISION y ya había alguna firma, se retiran
 * las aprobaciones (ambas partes deben volver a aprobar) y queda registrado.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retirarAprobacionesSiRevision(sb: any, ordenId: string, estado: string) {
  if (estado !== 'EN_REVISION') return
  const { data: o } = await sb.from('ordenes_insumo')
    .select('aprobado_solicitante_at, aprobado_coordinador_at').eq('id', ordenId).single()
  const habiaFirma = Boolean(o?.aprobado_solicitante_at || o?.aprobado_coordinador_at)
  if (!habiaFirma) return

  await sb.from('ordenes_insumo').update(RESET_APROBACIONES).eq('id', ordenId)
  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'APROBACION_RETIRADA',
    p_mensaje: 'Se retiraron las aprobaciones por un cambio en el pedido durante la revisión. Ambas partes deben aprobar de nuevo.',
  })
}

/** Ajusta la cantidad de un ítem (pre o post aprobación). */
export async function actualizarItemSolicitado(
  ordenId: string, itemId: string, cantidad: number,
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para editar el pedido.' }
  }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado, numero').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!EDITABLES.includes(orden.estado)) return { error: 'La orden ya fue despachada o cerrada; no se puede modificar.' }

  const cant = Math.max(0, Number(cantidad) || 0)
  const { data: antes } = await sb.from('orden_insumo_items')
    .select('cantidad_solicitada, producto:productos ( nombre_estandar )').eq('id', itemId).single()

  const quien = await nombreUsuario(sb, user.id)
  const esAprobada = ESTADOS_APROBADOS.includes(orden.estado)
  const { error } = await sb.from('orden_insumo_items')
    .update({
      cantidad_solicitada: cant,
      // En orden aprobada no pisamos la cantidad alistada (bodega puede haberla ajustado).
      ...(esAprobada ? {} : { cantidad_alistada: cant }),
      modificado_por: user.id, modificado_nombre: quien, modificado_at: new Date().toISOString(),
    })
    .eq('id', itemId)
  if (error) return { error: error.message }

  const prod = antes?.producto?.nombre_estandar ?? 'producto'
  if (antes && Number(antes.cantidad_solicitada) !== cant) {
    const prefijo = esAprobada ? 'Novedad post-aprobación — ' : ''
    await sb.rpc('oi_evento', {
      p_orden: ordenId, p_tipo: 'AJUSTE',
      p_mensaje: `${prefijo}Ajustó «${prod}»: ${antes.cantidad_solicitada} → ${cant}`,
      p_detalle: { item_id: itemId, antes: antes.cantidad_solicitada, despues: cant },
    })
    await retirarAprobacionesSiRevision(sb, ordenId, orden.estado)

    if (esAprobada) {
      await emitirNotificacion(sb, {
        codigo: 'SISTEMA',
        titulo: `Novedad en orden aprobada ${orden.numero}`,
        descripcion: `${quien} ajustó «${prod}»: ${antes.cantidad_solicitada} → ${cant}`,
        entidad: 'ordenes_insumo', entidadId: ordenId,
        enlace: `/ordenes-insumo/${ordenId}`,
      })
    }
  }

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
}

/** Agrega un producto a la orden (pre o post aprobación). */
export async function agregarItemSolicitado(
  ordenId: string, productoId: string, cantidad: number, esAdicional: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para editar el pedido.' }
  }
  const sb = supabase as DB

  const cant = Math.max(1, Number(cantidad) || 0)
  if (!productoId) return { error: 'Selecciona un producto.' }

  const { data: orden } = await sb.from('ordenes_insumo').select('estado, numero').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!EDITABLES.includes(orden.estado)) return { error: 'La orden ya fue despachada o cerrada; no se puede modificar.' }

  const { data: existe } = await sb.from('orden_insumo_items')
    .select('id').eq('orden_id', ordenId).eq('producto_id', productoId).maybeSingle()
  if (existe) return { error: 'Ese producto ya está en la orden. Ajusta su cantidad.' }

  const { data: prod } = await sb.from('productos').select('nombre_estandar').eq('id', productoId).single()
  const quien = await nombreUsuario(sb, user.id)
  const esAprobada = ESTADOS_APROBADOS.includes(orden.estado)

  const { error } = await sb.from('orden_insumo_items').insert({
    orden_id: ordenId, producto_id: productoId,
    cantidad_solicitada: cant, cantidad_maxima_ref: null,
    es_adicional: true, cantidad_alistada: cant,
    modificado_por: user.id, modificado_nombre: quien, modificado_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }

  const prefijo = esAprobada ? 'Novedad post-aprobación — ' : ''
  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'ITEM_AGREGADO',
    p_mensaje: `${prefijo}Agregó «${prod?.nombre_estandar ?? 'producto'}» (${cant}) · adicional`,
    p_detalle: { producto_id: productoId, cantidad: cant, es_adicional: true },
  })
  await retirarAprobacionesSiRevision(sb, ordenId, orden.estado)

  if (esAprobada) {
    await emitirNotificacion(sb, {
      codigo: 'SISTEMA',
      titulo: `Novedad en orden aprobada ${orden.numero}`,
      descripcion: `${quien} agregó «${prod?.nombre_estandar ?? 'producto'}» (${cant}) a la orden.`,
      entidad: 'ordenes_insumo', entidadId: ordenId,
      enlace: `/ordenes-insumo/${ordenId}`,
    })
  }

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
}

/** Quita un producto de la orden (pre o post aprobación). */
export async function quitarItemSolicitado(ordenId: string, itemId: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para editar el pedido.' }
  }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado, numero').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!EDITABLES.includes(orden.estado)) return { error: 'La orden ya fue despachada o cerrada; no se puede modificar.' }

  const { data: item } = await sb.from('orden_insumo_items')
    .select('producto:productos ( nombre_estandar )').eq('id', itemId).single()

  const { error } = await sb.from('orden_insumo_items').delete().eq('id', itemId)
  if (error) return { error: error.message }

  const esAprobada = ESTADOS_APROBADOS.includes(orden.estado)
  const prefijo = esAprobada ? 'Novedad post-aprobación — ' : ''
  const nomProd = item?.producto?.nombre_estandar ?? 'producto'
  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'ITEM_QUITADO',
    p_mensaje: `${prefijo}Quitó «${nomProd}» de la orden.`,
    p_detalle: { item_id: itemId },
  })
  await retirarAprobacionesSiRevision(sb, ordenId, orden.estado)

  if (esAprobada) {
    const quien = await nombreUsuario(sb, user.id)
    await emitirNotificacion(sb, {
      codigo: 'SISTEMA',
      titulo: `Novedad en orden aprobada ${orden.numero}`,
      descripcion: `${quien} quitó «${nomProd}» de la orden.`,
      entidad: 'ordenes_insumo', entidadId: ordenId,
      enlace: `/ordenes-insumo/${ordenId}`,
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

  // Pedir cambios invalida cualquier firma previa: ambos aprueban de nuevo.
  const { error } = await sb.from('ordenes_insumo')
    .update({ estado: 'CAMBIOS_SOLICITADOS', ...RESET_APROBACIONES }).eq('id', ordenId)
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
  // Se puede recibir tanto una orden despachada como una ya entregada por el
  // conductor (flujo con ruta: DESPACHADO → EN_RUTA → ENTREGADO → RECIBIDO).
  const estadosRecibibles = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO']
  if (!estadosRecibibles.includes(orden.estado)) return { error: 'Solo se recibe una orden ya enviada o entregada.' }

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
    p_ant: orden.estado, p_nue: 'RECIBIDO',
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
export interface DespachoInfo {
  /** CONDUCTOR_PROPIO = flota propia; TRANSPORTADORA = tercero. */
  tipo: 'CONDUCTOR_PROPIO' | 'TRANSPORTADORA'
  conductorId?: string | null
  transportadoraNombre?: string | null
  transportadoraGuia?: string | null
}

export async function despacharOrden(
  ordenId: string, videoPath: string, videoMime: string | null, despacho?: DespachoInfo,
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('alistar_ordenes_insumo')) return { error: 'No tienes permiso para despachar.' }
  const sb = supabase as DB

  if (!videoPath) return { error: 'Falta el video del despacho.' }

  // Validar el tipo de despacho (conductor propio vs transportadora tercera).
  const tipo = despacho?.tipo
  if (tipo !== 'CONDUCTOR_PROPIO' && tipo !== 'TRANSPORTADORA') {
    return { error: 'Indica si el despacho va con conductor propio o con transportadora.' }
  }
  if (tipo === 'CONDUCTOR_PROPIO' && !despacho?.conductorId) {
    return { error: 'Selecciona el conductor propio que lleva el pedido.' }
  }
  if (tipo === 'TRANSPORTADORA' && !despacho?.transportadoraNombre?.trim()) {
    return { error: 'Escribe el nombre de la transportadora.' }
  }

  const { data: orden } = await sb.from('ordenes_insumo').select('id, estado, sede_id, bodega_id').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (orden.estado === 'DESPACHADO') return { error: 'La orden ya fue despachada.' }
  if (orden.estado === 'ANULADA') return { error: 'La orden está anulada.' }

  // Paginado: una orden puede tener un ítem por producto del catálogo y
  // PostgREST corta en 1.000 filas. Si aquí faltaran ítems, se despacharía la
  // orden descontando stock de menos.
  const lista = await traerTodo<{ id: string; producto_id: string; cantidad_solicitada: number; cantidad_alistada: number; alistado: boolean }>(
    (desde, hasta) => sb.from('orden_insumo_items')
      .select('id, producto_id, cantidad_solicitada, cantidad_alistada, alistado')
      .eq('orden_id', ordenId).order('id').range(desde, hasta),
  )
  if (lista.length === 0) return { error: 'La orden no tiene ítems para despachar.' }

  // Cantidad efectiva: la alistada y, si quedó en cero, lo solicitado.
  const cantDe = (it: { cantidad_alistada: number; cantidad_solicitada: number }) =>
    Number(it.cantidad_alistada) > 0 ? Number(it.cantidad_alistada) : Number(it.cantidad_solicitada)

  // Se despacha lo chuleado; si no se chuleó nada, sale la orden completa.
  // Solo se despacha lo ALISTADO (chuleado con cantidad). Lo no alistado —incluido
  // lo que no tenía stock— NO sale en el despacho ni mueve inventario.
  const aDespachar = lista.filter((it) => it.alistado && cantDe(it) > 0)
  if (aDespachar.length === 0) {
    return { error: 'No hay ítems alistados para despachar. Marca al menos un producto como alistado.' }
  }

  // Registrar SALIDA de stock (traslado a la sede) por cada ítem alistado.
  let fallos = 0
  for (const it of aDespachar) {
    const { error } = await sb.rpc('registrar_movimiento', {
      p_producto: it.producto_id,
      p_tipo: 'SALIDA',
      p_cantidad: cantDe(it),
      p_sede: orden.sede_id,
      p_observacion: `Despacho orden de insumo`,
      p_ubicacion: null,
    })
    if (error) fallos++
  }
  if (fallos === aDespachar.length) {
    return { error: 'No se pudo registrar la salida de stock (permisos o stock). No se despachó.' }
  }

  // Deja registrada en el ítem la cantidad que realmente salió (la remisión la usa).
  for (const it of aDespachar) {
    if (Number(it.cantidad_alistada) === cantDe(it) && it.alistado) continue
    await sb.from('orden_insumo_items')
      .update({
        cantidad_alistada: cantDe(it),
        alistado: true,
        // Solo se atribuye el alistamiento si nadie lo había marcado.
        ...(it.alistado ? {} : { alistado_por: user.id, alistado_at: new Date().toISOString() }),
      })
      .eq('id', it.id)
  }

  const esPropio = tipo === 'CONDUCTOR_PROPIO'
  const { error: updErr } = await sb.from('ordenes_insumo').update({
    estado: 'DESPACHADO' as const, despachado_por: user.id, despachado_at: new Date().toISOString(),
    video_path: videoPath, video_mime: videoMime,
    tipo_despacho: tipo,
    conductor_id: esPropio ? despacho?.conductorId ?? null : null,
    transportadora_nombre: esPropio ? null : despacho?.transportadoraNombre?.trim() ?? null,
    transportadora_guia: esPropio ? null : despacho?.transportadoraGuia?.trim() || null,
  }).eq('id', ordenId)
  if (updErr) return { error: 'Salida registrada pero no se pudo cerrar la orden: ' + updErr.message }

  // Deja en la trazabilidad cómo salió el despacho.
  let detalleDespacho: string
  if (esPropio) {
    // Vía la vista (no `usuarios`) para que el nombre sea legible también al
    // bodeguero, cuya RLS le impide leer otras filas de usuarios.
    const { data: cond } = await sb.from('conductores_opciones').select('nombre').eq('usuario_id', despacho?.conductorId).maybeSingle()
    detalleDespacho = `Despachada con conductor propio: ${cond?.nombre ?? 'conductor'}.`
  } else {
    const guia = despacho?.transportadoraGuia?.trim()
    detalleDespacho = `Despachada con transportadora ${despacho?.transportadoraNombre?.trim()}${guia ? ` · guía ${guia}` : ''}.`
  }
  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'DESPACHO', p_mensaje: detalleDespacho,
    p_nue: 'DESPACHADO',
    p_detalle: {
      tipo_despacho: tipo, conductor_id: esPropio ? despacho?.conductorId : null,
      transportadora: esPropio ? null : despacho?.transportadoraNombre?.trim(),
      guia: esPropio ? null : despacho?.transportadoraGuia?.trim() || null,
    },
  })

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  revalidatePath('/ordenes-insumo')
  return { ok: true, error: fallos > 0 ? `Despachada con ${fallos} ítem(s) sin descontar stock.` : undefined }
}

/**
 * Registra en trazabilidad que se generó un PDF de la orden (orden o remisión).
 * La versión se calcula contando generaciones previas del mismo tipo.
 */
export async function registrarGeneracionPDF(
  ordenId: string, tipo: 'ORDEN' | 'REMISION', storagePath: string,
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Sin sesión.' }
  const sb = supabase as DB

  const { data: prev } = await sb.from('orden_insumo_eventos')
    .select('detalle').eq('orden_id', ordenId).eq('tipo', 'PDF_GENERADO')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const version = ((prev ?? []) as { detalle: any }[]).filter(e => e.detalle?.tipo === tipo).length + 1

  const label = tipo === 'REMISION' ? 'Remisión de despacho' : 'Orden de insumo'
  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'PDF_GENERADO',
    p_mensaje: `Generó la ${label} (PDF)${version > 1 ? ` · versión ${version}` : ''}`,
    p_detalle: { tipo, path: storagePath, version },
  })
  revalidatePath(`/ordenes-insumo/${ordenId}`)
  return { ok: true }
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

/**
 * Registra la dirección de despacho en la sede (sedes.direccion). Vía función
 * SECURITY DEFINER, porque write_sedes solo deja a ADMIN pero quien despacha
 * necesita poder registrarla cuando la sede aún no la tiene.
 */
export async function guardarDireccionSede(sedeId: string, direccion: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('alistar_ordenes_insumo') && !perm.puede('crear_ordenes_insumo')
      && !perm.puede('aprobar_ordenes_insumo') && !perm.puede('editar_contratos')) {
    return { error: 'No tienes permiso para registrar la dirección.' }
  }
  if (!sedeId) return { error: 'Sede no válida.' }
  const sb = supabase as DB
  const { error } = await sb.rpc('oi_set_direccion_sede', { p_sede: sedeId, p_direccion: direccion ?? '' })
  if (error) return { error: error.message }
  revalidatePath('/ordenes-insumo')
  return { ok: true }
}

/** Fija/actualiza la urgencia y la fecha de entrega pactada de una orden. */
export async function actualizarUrgencia(
  ordenId: string, patch: { urgente?: boolean; fechaEntrega?: string | null },
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo') && !perm.puede('alistar_ordenes_insumo')) {
    return { error: 'No tienes permiso para cambiar la urgencia.' }
  }
  const sb = supabase as DB

  const upd: Record<string, unknown> = {}
  if (patch.urgente !== undefined) upd.urgente = !!patch.urgente
  if (patch.fechaEntrega !== undefined) upd.fecha_entrega_pactada = patch.fechaEntrega || null
  if (Object.keys(upd).length === 0) return { ok: true }

  const { error } = await sb.from('ordenes_insumo').update(upd).eq('id', ordenId)
  if (error) return { error: error.message }

  const partes: string[] = []
  if (patch.urgente !== undefined) partes.push(patch.urgente ? 'marcada como URGENTE' : 'quitada la marca de urgente')
  if (patch.fechaEntrega !== undefined) partes.push(patch.fechaEntrega ? `entrega pactada: ${patch.fechaEntrega}` : 'sin fecha de entrega')
  await sb.rpc('oi_evento', { p_orden: ordenId, p_tipo: 'URGENCIA', p_mensaje: `Prioridad actualizada — ${partes.join(' · ')}.` })

  revalidatePath(`/ordenes-insumo/${ordenId}`); revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  return { ok: true }
}

/**
 * Borra la orden por completo (ítems, eventos y responsables se borran en
 * cascada). No se permite borrar una orden que ya movió inventario o salió a
 * ruta: para esas se usa Anular, que conserva el histórico y el stock.
 */
export async function borrarOrden(ordenId: string): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('crear_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para borrar órdenes.' }
  }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('estado').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  const bloqueados = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO']
  if (bloqueados.includes(orden.estado)) {
    return { error: 'Esta orden ya movió inventario o salió a ruta. No se puede borrar; anúlala en su lugar.' }
  }

  // Dependencias sin ON DELETE CASCADE (por si tuviera ruta asignada).
  await sb.from('ruta_paradas').delete().eq('orden_id', ordenId)
  // orden_insumo_items / eventos / responsables se borran en cascada.
  const { error } = await sb.from('ordenes_insumo').delete().eq('id', ordenId)
  if (error) return { error: error.message }

  revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento')
  return { ok: true }
}

// ── Devoluciones: la sede regresa parte de un pedido ya despachado ────────────
export type MotivoDevolucion = 'SOBRANTE' | 'AVERIADO' | 'ERRADO' | 'NO_REQUERIDO' | 'OTRO'

export interface DevolucionInput {
  motivo: MotivoDevolucion
  observacion?: string | null
  /** false cuando el producto vuelve inservible (averiado/vencido): no suma stock. */
  reingresaStock?: boolean
  items: { itemId: string; cantidad: number }[]
}

/**
 * Registra una devolución de la orden: qué productos y cuántas unidades
 * regresaron. Todo (cabecera + ítems + reingreso de stock + trazabilidad) se
 * hace en una sola transacción dentro de `registrar_devolucion_oi`.
 */
export async function registrarDevolucion(ordenId: string, input: DevolucionInput): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('alistar_ordenes_insumo') && !perm.puede('aprobar_ordenes_insumo')) {
    return { error: 'No tienes permiso para registrar devoluciones.' }
  }
  const sb = supabase as DB

  const items = (input.items ?? [])
    .map((i) => ({ item_id: i.itemId, cantidad: Number(i.cantidad) }))
    .filter((i) => i.item_id && Number.isFinite(i.cantidad) && i.cantidad > 0)
  if (items.length === 0) return { error: 'Marca al menos un producto con la cantidad devuelta.' }

  const { data, error } = await sb.rpc('registrar_devolucion_oi', {
    p_orden: ordenId,
    p_motivo: input.motivo || 'OTRO',
    p_items: items,
    p_observacion: input.observacion?.trim() || null,
    p_reingresa: input.reingresaStock !== false,
  })
  if (error) {
    return { error: error.message.includes('row-level security') ? 'Sin permisos para devolver stock.' : error.message }
  }

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento'); revalidatePath('/movimientos')
  return { ok: true, id: (data as string) ?? undefined }
}

// ── Envío restante: despachar lo que quedó pendiente de una orden ya despachada ─
export async function registrarEnvioRestante(
  ordenId: string, envios: { itemId: string; cantidad: number }[],
): Promise<ActionResult> {
  const { supabase, user } = await sesion()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const perm = await getPermisosUsuario()
  if (!perm.puede('alistar_ordenes_insumo')) return { error: 'No tienes permiso para despachar.' }
  const sb = supabase as DB

  const { data: orden } = await sb.from('ordenes_insumo').select('id, numero, estado, sede_id').eq('id', ordenId).single()
  if (!orden) return { error: 'Orden no encontrada.' }
  if (!['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO'].includes(orden.estado)) {
    return { error: 'El envío restante solo aplica a órdenes ya despachadas.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await traerTodo<any>((desde, hasta) => sb.from('orden_insumo_items')
    .select('id, producto_id, cantidad_solicitada, cantidad_alistada, producto:productos ( nombre_estandar )')
    .eq('orden_id', ordenId).order('id').range(desde, hasta))
  const mapItems = new Map(items.map((it) => [it.id, it]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detalle: any[] = []
  let totalUnidades = 0
  for (const e of envios) {
    const it = mapItems.get(e.itemId)
    if (!it) continue
    const pendiente = Math.max(0, Number(it.cantidad_solicitada) - Number(it.cantidad_alistada))
    const add = Math.max(0, Math.min(pendiente, Number(e.cantidad) || 0))
    if (add <= 0) continue
    const { error: movErr } = await sb.rpc('registrar_movimiento', {
      p_producto: it.producto_id, p_tipo: 'SALIDA', p_cantidad: add,
      p_sede: orden.sede_id, p_observacion: `Envío restante orden ${orden.numero}`, p_ubicacion: null,
    })
    if (movErr) {
      return { error: movErr.message.includes('row-level security')
        ? 'No tienes permiso para descontar del inventario.'
        : 'No se pudo registrar la salida: ' + movErr.message }
    }
    await sb.from('orden_insumo_items').update({ cantidad_alistada: Number(it.cantidad_alistada) + add }).eq('id', it.id)
    it.cantidad_alistada = Number(it.cantidad_alistada) + add
    totalUnidades += add
    detalle.push({ producto: it.producto?.nombre_estandar ?? '?', cantidad: add })
  }

  if (totalUnidades === 0) return { error: 'No hay cantidades para enviar (todo lo pendiente ya está en 0).' }

  await sb.rpc('oi_evento', {
    p_orden: ordenId, p_tipo: 'ENVIO_RESTANTE',
    p_mensaje: `Envío restante: ${totalUnidades} unidad(es) en ${detalle.length} producto(s).`,
    p_detalle: { items: detalle, total: totalUnidades },
  })

  revalidatePath(`/ordenes-insumo/${ordenId}`)
  revalidatePath('/ordenes-insumo'); revalidatePath('/alistamiento'); revalidatePath('/stock')
  return { ok: true }
}
