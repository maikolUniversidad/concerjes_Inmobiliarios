'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult { error?: string; ok?: boolean }

function numeroOpc(v: FormDataEntryValue | null): number | null {
  if (v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function campos(formData: FormData) {
  return {
    grupo_id: String(formData.get('grupo_id') ?? ''),
    nombre: String(formData.get('nombre') ?? '').trim(),
    codigo_interno: String(formData.get('codigo_interno') ?? '').trim() || null,
    zona: String(formData.get('zona') ?? '').trim() || null,
    ciudad: String(formData.get('ciudad') ?? '').trim() || 'BOGOTÁ D.C.',
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    lat: numeroOpc(formData.get('lat')),
    lng: numeroOpc(formData.get('lng')),
  }
}

/**
 * Geocodifica una dirección con Nominatim (OpenStreetMap). Server-side para
 * respetar la política de uso (User-Agent) y evitar CORS. Sin API key.
 */
export async function geocodificarSede(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = query.trim()
  if (q.length < 4) return null
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=co&q=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ConserjesInmobiliarios/1.0 (logistica-entregas)' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
    if (!arr.length) return null
    return { lat: Number(arr[0].lat), lng: Number(arr[0].lon), label: arr[0].display_name }
  } catch {
    return null
  }
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere rol Admin).'
  return 'Operación fallida: ' + msg
}

export async function crearSede(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const data = campos(formData)
  if (!data.grupo_id) return { error: 'Selecciona el grupo de contrato.' }
  if (data.nombre.length < 3) return { error: 'El nombre de la sede es obligatorio.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('sedes').insert(data)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

export async function actualizarSede(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Sede no especificada.' }
  const data = campos(formData)
  if (!data.grupo_id) return { error: 'Selecciona el grupo de contrato.' }
  if (data.nombre.length < 3) return { error: 'El nombre de la sede es obligatorio.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('sedes').update(data).eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

export async function eliminarSede(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('sedes').update({ activo: false }).eq('id', id)
  revalidatePath('/contratos')
}
