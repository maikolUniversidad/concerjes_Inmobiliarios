'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'

async function db() {
  return (await createClient()) as any
}

// ── Resumen ─────────────────────────────────────────────────────────────────

export async function getResumenServiciosHogar() {
  const s = await db()
  const hoy = new Date().toISOString().split('T')[0]

  const [pendientes, confirmadas, hoyResult, completadas] = await Promise.all([
    s.from('solicitudes_servicio_hogar').select('id', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
    s.from('solicitudes_servicio_hogar').select('id', { count: 'exact', head: true }).eq('estado', 'CONFIRMADA'),
    s.from('solicitudes_servicio_hogar').select('id', { count: 'exact', head: true }).eq('fecha_deseada', hoy),
    s.from('solicitudes_servicio_hogar').select('id', { count: 'exact', head: true }).eq('estado', 'COMPLETADA'),
  ])

  return {
    pendientes: pendientes.count ?? 0,
    confirmadas: confirmadas.count ?? 0,
    hoy:         hoyResult.count ?? 0,
    completadas: completadas.count ?? 0,
  }
}

export async function getSolicitudesRecientes() {
  const s = await db()
  const { data, error } = await s
    .from('solicitudes_servicio_hogar')
    .select(`id, numero, cliente_nombre, cliente_telefono, estado, fecha_deseada, hora_inicio,
             frecuencia, created_at,
             tipos_servicio_hogar(nombre, icono)`)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw error
  return data ?? []
}

// ── Solicitudes ──────────────────────────────────────────────────────────────

export async function getSolicitudes(params?: { estado?: string; search?: string; page?: number }) {
  const s = await db()
  const limit = 20
  const offset = ((params?.page ?? 1) - 1) * limit

  let q = s
    .from('solicitudes_servicio_hogar')
    .select(`*, tipos_servicio_hogar(nombre, icono), tarifas_servicio_hogar(nombre)`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (params?.estado && params.estado !== 'TODOS') {
    q = q.eq('estado', params.estado)
  }
  if (params?.search) {
    q = q.or(`cliente_nombre.ilike.%${params.search}%,cliente_email.ilike.%${params.search}%,numero.ilike.%${params.search}%`)
  }

  const { data, error, count } = await q
  if (error) throw error
  return { solicitudes: data ?? [], total: count ?? 0 }
}

export async function updateEstadoSolicitud(id: string, estado: string, motivo?: string) {
  const falta = await faltaPermiso('gestionar_solicitudes_hogar')
  if (falta) throw new Error(falta)

  const s = await db()
  const updates: any = { estado }
  if (estado === 'CONFIRMADA') updates.confirmado_at = new Date().toISOString()
  if (estado === 'COMPLETADA') updates.completado_at = new Date().toISOString()
  if (motivo) updates.motivo_cancelacion = motivo

  const { error } = await s
    .from('solicitudes_servicio_hogar')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function asignarConcierje(solicitudId: string, userId: string) {
  const falta = await faltaPermiso('gestionar_solicitudes_hogar')
  if (falta) throw new Error(falta)

  const s = await db()
  const { error } = await s
    .from('solicitudes_servicio_hogar')
    .update({ asignado_a: userId, estado: 'CONFIRMADA', confirmado_at: new Date().toISOString() })
    .eq('id', solicitudId)
  if (error) throw error
}

// ── Agenda ───────────────────────────────────────────────────────────────────

export async function getAgenda(semanaInicio: string) {
  const s = await db()
  // 7 días desde semanaInicio
  const fin = new Date(semanaInicio)
  fin.setDate(fin.getDate() + 6)
  const semanaFin = fin.toISOString().split('T')[0]

  const { data, error } = await s
    .from('agenda_servicio_hogar')
    .select(`*, solicitudes_servicio_hogar(numero, cliente_nombre, cliente_telefono,
             tipos_servicio_hogar(nombre, icono))`)
    .gte('fecha', semanaInicio)
    .lte('fecha', semanaFin)
    .order('fecha')
    .order('hora_inicio')

  if (error) throw error
  return data ?? []
}

export async function crearSesionAgenda(payload: {
  solicitud_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  concierje_id?: string
  notas?: string
}) {
  const falta = await faltaPermiso('gestionar_agenda_hogar')
  if (falta) throw new Error(falta)

  const s = await db()
  const { error } = await s.from('agenda_servicio_hogar').insert(payload)
  if (error) throw error
}

// ── Tipos de servicio ─────────────────────────────────────────────────────────

export async function getTiposServicio() {
  const s = await db()
  const { data, error } = await s
    .from('tipos_servicio_hogar')
    .select('*')
    .order('orden')
  if (error) throw error
  return data ?? []
}

export async function upsertTipoServicio(tipo: any) {
  const falta = await faltaPermiso('gestionar_tipos_servicio')
  if (falta) throw new Error(falta)

  const s = await db()
  const { id, ...rest } = tipo
  if (id) {
    const { error } = await s.from('tipos_servicio_hogar').update(rest).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await s.from('tipos_servicio_hogar').insert(rest)
    if (error) throw error
  }
}

export async function toggleTipoServicioActivo(id: string, activo: boolean) {
  const falta = await faltaPermiso('gestionar_tipos_servicio')
  if (falta) throw new Error(falta)

  const s = await db()
  const { error } = await s.from('tipos_servicio_hogar').update({ activo }).eq('id', id)
  if (error) throw error
}

// ── Tarifas ───────────────────────────────────────────────────────────────────

export async function getTarifas(tipoId?: string) {
  const s = await db()
  let q = s
    .from('tarifas_servicio_hogar')
    .select(`*, tipos_servicio_hogar(nombre, icono)`)
    .order('personas_incluidas')
    .order('duracion_horas')
  if (tipoId) q = q.eq('tipo_id', tipoId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function upsertTarifa(tarifa: any) {
  const falta = await faltaPermiso('gestionar_precios_servicio')
  if (falta) throw new Error(falta)

  const s = await db()
  const { id, ...rest } = tarifa
  if (id) {
    const { error } = await s.from('tarifas_servicio_hogar').update(rest).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await s.from('tarifas_servicio_hogar').insert(rest)
    if (error) throw error
  }
}

export async function deleteTarifa(id: string) {
  const falta = await faltaPermiso('gestionar_precios_servicio')
  if (falta) throw new Error(falta)

  const s = await db()
  const { error } = await s.from('tarifas_servicio_hogar').delete().eq('id', id)
  if (error) throw error
}
