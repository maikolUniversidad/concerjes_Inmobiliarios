'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'

// Las nuevas tablas del módulo conductor no están en el tipo Database generado.
// Usamos 'any' para estas tablas hasta regenerar tipos con `supabase gen types`.
async function db() {
  return (await createClient()) as any
}

// ─── Conductores ────────────────────────────────────────────────────────────

export async function getConductores() {
  const s = await db()
  const { data, error } = await s
    .from('conductores')
    .select('*, usuario:usuarios(id, nombre, email, rol)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function crearConductor(form: {
  usuario_id: string
  placa_vehiculo?: string
  tipo_vehiculo?: string
  telefono_contacto?: string
  zona?: string
  licencia_categoria?: string
}) {
  await requirePermiso('gestionar_conductores')
  const s = await db()
  const { error } = await s.from('conductores').insert(form)
  if (error) throw new Error(error.message)
  revalidatePath('/logistica/conductores')
}

export async function actualizarConductor(id: string, form: {
  placa_vehiculo?: string
  tipo_vehiculo?: string
  telefono_contacto?: string
  zona?: string
  licencia_categoria?: string
  activo?: boolean
}) {
  await requirePermiso('gestionar_conductores')
  const s = await db()
  const { error } = await s.from('conductores').update(form).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/logistica/conductores')
}

// ─── Horarios de Entrega ────────────────────────────────────────────────────

export async function getHorariosSede() {
  const s = await db()
  const { data, error } = await s
    .from('sede_horario_entrega')
    .select('*, sede:sedes(id, nombre, ciudad, zona)')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertHorarioSede(form: {
  sede_id: string
  ventana_am_inicio?: string | null
  ventana_am_fin?: string | null
  ventana_pm_inicio?: string | null
  ventana_pm_fin?: string | null
  supervisor_nombre?: string | null
  supervisor_contacto?: string | null
  notas?: string | null
}) {
  await requirePermiso('gestionar_horarios_entrega')
  const s = await db()
  const { error } = await s
    .from('sede_horario_entrega')
    .upsert({ ...form, updated_at: new Date().toISOString() }, { onConflict: 'sede_id' })
  if (error) throw new Error(error.message)
  revalidatePath('/logistica/horarios')
}

// ─── Rutas de Entrega ───────────────────────────────────────────────────────

export async function getRutas(fecha?: string) {
  const s = await db()
  let q = s
    .from('rutas_entrega')
    .select(`
      *,
      conductor:conductores(*, usuario:usuarios(id, nombre, email)),
      paradas:ruta_paradas(
        *,
        sede:sedes(id, nombre, ciudad, zona),
        orden:ordenes_insumo(id, numero, estado),
        confirmacion:confirmaciones_entrega(id, receptor_nombre, created_at),
        novedades:novedades_entrega(id, tipo, estado)
      )
    `)
    .order('created_at', { ascending: false })

  if (fecha) q = q.eq('fecha', fecha)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Tablero administrativo en vivo: todas las rutas del día con su conductor,
 * las paradas (sedes a visitar) y el detalle de "qué deben entregar" (ítems de
 * cada orden). Pensado para que el personal administrativo monitoree la
 * operación de entregas en tiempo real. El GPS se recibe aparte vía Realtime.
 */
export async function getMonitoreoEntregas(fecha?: string) {
  await requirePermiso('ver_monitoreo_entregas')
  const s = await db()
  const dia = fecha ?? new Date().toISOString().split('T')[0]

  const { data, error } = await s
    .from('rutas_entrega')
    .select(`
      *,
      conductor:conductores(
        id, placa_vehiculo, tipo_vehiculo, zona, telefono_contacto, activo,
        usuario:usuarios(id, nombre, email)
      ),
      paradas:ruta_paradas(
        *,
        sede:sedes(id, nombre, ciudad, zona),
        orden:ordenes_insumo(
          id, numero, estado,
          items:orden_insumo_items(
            id, cantidad_solicitada,
            producto:productos(nombre_estandar, presentacion)
          )
        ),
        confirmacion:confirmaciones_entrega(id, receptor_nombre, created_at),
        novedades:novedades_entrega(id, tipo, estado)
      )
    `)
    .eq('fecha', dia)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getRutaConductor() {
  const s = await db()
  const { data: { user } } = await s.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: conductor } = await s
    .from('conductores')
    .select('id')
    .eq('usuario_id', user.id)
    .maybeSingle()

  if (!conductor) return null

  const hoy = new Date().toISOString().split('T')[0]
  const { data, error } = await s
    .from('rutas_entrega')
    .select(`
      *,
      paradas:ruta_paradas(
        *,
        sede:sedes(id, nombre, ciudad, zona, codigo_interno),
        orden:ordenes_insumo(id, numero, estado, observacion),
        confirmacion:confirmaciones_entrega(*),
        novedades:novedades_entrega(*),
        horario:sede_horario_entrega(ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
      )
    `)
    .eq('conductor_id', conductor.id)
    .eq('fecha', hoy)
    .neq('estado', 'CANCELADA')
    .order('numero_parada', { ascending: true, referencedTable: 'paradas' })
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function crearRuta(form: {
  conductor_id: string
  fecha: string
  observaciones?: string
  orden_ids: string[]
}) {
  await requirePermiso('gestionar_rutas')
  const s = await db()
  const { data: { user } } = await s.auth.getUser()

  const fecha = form.fecha.replace(/-/g, '')
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  const codigo = `RUT-${fecha}-${random}`

  const { data: ruta, error: rutaErr } = await s
    .from('rutas_entrega')
    .insert({
      codigo,
      conductor_id: form.conductor_id,
      fecha: form.fecha,
      observaciones: form.observaciones,
      creado_por: user?.id,
    })
    .select('id')
    .single()

  if (rutaErr) throw new Error(rutaErr.message)

  const { data: ordenes } = await s
    .from('ordenes_insumo')
    .select('id, sede_id')
    .in('id', form.orden_ids)

  if (!ordenes) throw new Error('No se encontraron órdenes')

  const paradas = form.orden_ids.map((orden_id: string, i: number) => {
    const orden = ordenes.find((o: any) => o.id === orden_id)
    return {
      ruta_id: ruta.id,
      orden_id,
      sede_id: orden!.sede_id,
      numero_parada: i + 1,
    }
  })

  const { data: paradasCreadas, error: paradasErr } = await s
    .from('ruta_paradas')
    .insert(paradas)
    .select('id, orden_id')

  if (paradasErr) throw new Error(paradasErr.message)

  // Obtener usuario_id del conductor para actualizar ordenes_insumo
  const { data: condData } = await s
    .from('conductores')
    .select('usuario_id')
    .eq('id', form.conductor_id)
    .single()

  for (const p of paradasCreadas) {
    await s
      .from('ordenes_insumo')
      .update({ conductor_id: condData?.usuario_id, ruta_parada_id: p.id })
      .eq('id', p.orden_id)
  }

  revalidatePath('/logistica/control')
  return ruta
}

export async function iniciarRuta(rutaId: string) {
  const s = await db()
  const { error } = await s
    .from('rutas_entrega')
    .update({ estado: 'EN_CURSO', iniciado_at: new Date().toISOString() })
    .eq('id', rutaId)
  if (error) throw new Error(error.message)

  const { data: paradas } = await s
    .from('ruta_paradas')
    .select('id, orden_id')
    .eq('ruta_id', rutaId)
    .eq('numero_parada', 1)

  if (paradas?.[0]) {
    await s.from('ordenes_insumo')
      .update({ estado: 'EN_RUTA', tomado_ruta_at: new Date().toISOString() })
      .eq('id', paradas[0].orden_id)
  }

  revalidatePath('/logistica/mis-rutas')
  revalidatePath('/logistica/control')
}

export async function llegarParada(paradaId: string) {
  const s = await db()
  const now = new Date().toISOString()

  const { data: parada, error: pErr } = await s
    .from('ruta_paradas')
    .update({ estado: 'EN_RUTA', llegado_at: now })
    .eq('id', paradaId)
    .select('orden_id')
    .single()

  if (pErr) throw new Error(pErr.message)

  await s.from('ordenes_insumo')
    .update({ estado: 'EN_RUTA', tomado_ruta_at: now })
    .eq('id', parada.orden_id)

  revalidatePath('/logistica/mis-rutas')
}

// ─── Confirmación de Entrega ────────────────────────────────────────────────

export async function confirmarEntrega(form: {
  parada_id: string
  ruta_id: string
  orden_id: string
  receptor_nombre: string
  receptor_cedula?: string
  receptor_cargo?: string
  foto_entrega_url?: string
  firma_url?: string
  lat?: number
  lng?: number
  items_recibidos?: Array<{producto_id: string; nombre: string; cantidad_confirmada: number}>
  observaciones?: string
}) {
  const s = await db()
  const { data: { user } } = await s.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: conductor } = await s
    .from('conductores')
    .select('id')
    .eq('usuario_id', user.id)
    .single()

  if (!conductor) throw new Error('No tienes perfil de conductor')

  const now = new Date().toISOString()

  const { error: confErr } = await s.from('confirmaciones_entrega').insert({
    ...form,
    conductor_id: conductor.id,
    items_recibidos: form.items_recibidos ?? [],
  })
  if (confErr) throw new Error(confErr.message)

  await s.from('ruta_paradas')
    .update({ estado: 'ENTREGADO', entregado_at: now })
    .eq('id', form.parada_id)

  await s.from('ordenes_insumo')
    .update({ estado: 'ENTREGADO' })
    .eq('id', form.orden_id)

  const { data: pendientes } = await s
    .from('ruta_paradas')
    .select('id')
    .eq('ruta_id', form.ruta_id)
    .not('estado', 'in', '("ENTREGADO","NOVEDAD","REPROGRAMADO")')

  if (!pendientes || pendientes.length === 0) {
    await s.from('rutas_entrega')
      .update({ estado: 'COMPLETADA', finalizado_at: now })
      .eq('id', form.ruta_id)
  }

  revalidatePath('/logistica/mis-rutas')
  revalidatePath('/logistica/control')
  revalidatePath('/ordenes-insumo')
}

// ─── Novedades ──────────────────────────────────────────────────────────────

export async function getNovedades(filtros?: { estado?: string; fecha?: string }) {
  const s = await db()
  let q = s
    .from('novedades_entrega')
    .select(`
      *,
      conductor:conductores(id, usuario:usuarios(nombre, email)),
      orden:ordenes_insumo(id, numero, sede:sedes(nombre, ciudad)),
      parada:ruta_paradas(id, numero_parada, sede:sedes(nombre))
    `)
    .order('created_at', { ascending: false })

  if (filtros?.estado) q = q.eq('estado', filtros.estado)
  if (filtros?.fecha) {
    const inicio = `${filtros.fecha}T00:00:00Z`
    const fin    = `${filtros.fecha}T23:59:59Z`
    q = q.gte('created_at', inicio).lte('created_at', fin)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function reportarNovedad(form: {
  ruta_id: string
  parada_id?: string
  orden_id?: string
  tipo: string
  descripcion: string
  lat?: number
  lng?: number
  foto_url?: string
}) {
  const s = await db()
  const { data: { user } } = await s.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: conductor } = await s
    .from('conductores')
    .select('id')
    .eq('usuario_id', user.id)
    .single()

  if (!conductor) throw new Error('No tienes perfil de conductor')

  const { error } = await s.from('novedades_entrega').insert({
    ...form,
    conductor_id: conductor.id,
  })
  if (error) throw new Error(error.message)

  if (form.parada_id) {
    await s.from('ruta_paradas')
      .update({ estado: 'NOVEDAD' })
      .eq('id', form.parada_id)
  }

  revalidatePath('/logistica/mis-rutas')
  revalidatePath('/logistica/novedades')
}

export async function resolverNovedad(id: string, resolucion: string) {
  await requirePermiso('gestionar_novedades_entrega')
  const s = await db()
  const { data: { user } } = await s.auth.getUser()

  const { error } = await s.from('novedades_entrega').update({
    estado: 'RESUELTA',
    resolucion,
    resuelto_por: user?.id,
    resuelto_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/logistica/novedades')
}

// ─── GPS (solo lectura server-side) ─────────────────────────────────────────

export async function getUbicacionesConductores() {
  await requirePermiso('ver_ubicacion_conductores')
  const s = await db()
  const { data, error } = await s
    .from('conductor_ubicacion_actual')
    .select('*, conductor:conductores(id, usuario:usuarios(nombre))')
    .eq('activo', true)
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── URL firmada para evidencias ─────────────────────────────────────────────

export async function getEvidenciaUrl(path: string) {
  const s = await db()
  const { data } = await s.storage
    .from('logistica-evidencia')
    .createSignedUrl(path, 60 * 60)
  return data?.signedUrl ?? null
}
