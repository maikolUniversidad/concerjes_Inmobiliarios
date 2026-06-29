'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

async function auth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere Admin, Bodeguero o Supervisor).'
  if (msg.includes('duplicate')) return 'Código duplicado en esta bodega.'
  return 'Operación fallida: ' + msg
}

// ─── BODEGAS ────────────────────────────────────────────────────────────────
export async function crearBodega(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const nombre = String(formData.get('nombre') ?? '').trim()
  if (nombre.length < 2) return { error: 'El nombre es obligatorio.' }

  const payload = {
    nombre,
    codigo: String(formData.get('codigo') ?? '').trim() || null,
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    descripcion: String(formData.get('descripcion') ?? '').trim() || null,
    plano_url: String(formData.get('plano_url') ?? '').trim() || null,
    responsable_id: String(formData.get('responsable_id') ?? '') || null,
  }
  const { data, error } = await (supabase as DB).from('bodegas').insert(payload).select('id').single()
  if (error) return { error: traducir(error.message) }
  await logActivity(supabase as DB, { accion: 'CREAR', modulo: 'Bodegas', descripcion: `Bodega creada: ${nombre}`, entidad: 'bodegas', entidad_id: data.id })
  revalidatePath('/bodegas')
  redirect(`/bodegas/${data.id}`)
}

export async function actualizarBodega(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Bodega no especificada.' }
  const payload = {
    nombre: String(formData.get('nombre') ?? '').trim(),
    codigo: String(formData.get('codigo') ?? '').trim() || null,
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    descripcion: String(formData.get('descripcion') ?? '').trim() || null,
    plano_url: String(formData.get('plano_url') ?? '').trim() || null,
    responsable_id: String(formData.get('responsable_id') ?? '') || null,
  }
  const { error } = await (supabase as DB).from('bodegas').update(payload).eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/bodegas'); revalidatePath(`/bodegas/${id}`)
  redirect(`/bodegas/${id}`)
}

export async function eliminarBodega(formData: FormData): Promise<void> {
  const { supabase, user } = await auth()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await (supabase as DB).from('bodegas').update({ activo: false }).eq('id', id)
  revalidatePath('/bodegas')
  redirect('/bodegas')
}

// ─── UBICACIONES (callable directo desde el plano) ───────────────────────────
export async function crearUbicacion(input: {
  bodega_id: string; codigo: string; nombre?: string; tipo?: string
  descripcion?: string; pos_x?: number; pos_y?: number; responsable_id?: string | null; foto_url?: string | null
}): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  if (!input.bodega_id) return { error: 'Bodega no especificada.' }
  if (!input.codigo || !input.codigo.trim()) return { error: 'El código de la ubicación es obligatorio.' }

  const { data, error } = await (supabase as DB).from('ubicaciones').insert({
    bodega_id: input.bodega_id,
    codigo: input.codigo.trim(),
    nombre: input.nombre?.trim() || null,
    tipo: input.tipo || 'ESTANTERIA',
    descripcion: input.descripcion?.trim() || null,
    pos_x: input.pos_x ?? null,
    pos_y: input.pos_y ?? null,
    responsable_id: input.responsable_id || null,
    foto_url: input.foto_url || null,
  }).select('id').single()
  if (error) return { error: traducir(error.message) }
  revalidatePath(`/bodegas/${input.bodega_id}`)
  return { ok: true, id: data.id }
}

export async function actualizarUbicacion(input: {
  id: string; bodega_id: string; codigo: string; nombre?: string; tipo?: string
  descripcion?: string; responsable_id?: string | null; foto_url?: string | null
}): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  if (!input.id) return { error: 'Ubicación no especificada.' }
  const { error } = await (supabase as DB).from('ubicaciones').update({
    codigo: input.codigo.trim(),
    nombre: input.nombre?.trim() || null,
    tipo: input.tipo || 'ESTANTERIA',
    descripcion: input.descripcion?.trim() || null,
    responsable_id: input.responsable_id || null,
    foto_url: input.foto_url || null,
  }).eq('id', input.id)
  if (error) return { error: traducir(error.message) }
  revalidatePath(`/bodegas/${input.bodega_id}`)
  return { ok: true }
}

export async function moverUbicacion(id: string, bodega_id: string, pos_x: number, pos_y: number): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const { error } = await (supabase as DB).from('ubicaciones')
    .update({ pos_x: Math.round(pos_x * 100) / 100, pos_y: Math.round(pos_y * 100) / 100 }).eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath(`/bodegas/${bodega_id}`)
  return { ok: true }
}

export async function eliminarUbicacion(id: string, bodega_id: string): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  // Desvincula productos antes de borrar
  await (supabase as DB).from('productos').update({ ubicacion_id: null }).eq('ubicacion_id', id)
  const { error } = await (supabase as DB).from('ubicaciones').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath(`/bodegas/${bodega_id}`)
  return { ok: true }
}

// ─── ASIGNAR PRODUCTO A UBICACIÓN ────────────────────────────────────────────
export async function asignarProductoUbicacion(productoId: string, ubicacionId: string | null, bodega_id: string): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const { error } = await (supabase as DB).from('productos').update({ ubicacion_id: ubicacionId }).eq('id', productoId)
  if (error) return { error: traducir(error.message) }
  revalidatePath(`/bodegas/${bodega_id}`); revalidatePath('/productos')
  return { ok: true }
}
