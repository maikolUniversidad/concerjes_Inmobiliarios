'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult { error?: string; ok?: boolean }

function campos(formData: FormData) {
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    nit: String(formData.get('nit') ?? '').trim() || null,
    contacto: String(formData.get('contacto') ?? '').trim() || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    logo_url: String(formData.get('logo_url') ?? '').trim() || null,
    es_principal: formData.get('es_principal') === 'on',
  }
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere Admin o Coord. Compras).'
  if (msg.includes('duplicate')) return 'Ya existe un proveedor con ese NIT.'
  return 'Operación fallida: ' + msg
}

export async function crearProveedor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const data = campos(formData)
  if (data.nombre.length < 2) return { error: 'El nombre es obligatorio.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('proveedores').insert(data)
  if (error) return { error: traducir(error.message) }

  revalidatePath('/proveedores')
  return { ok: true }
}

export async function actualizarProveedor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Proveedor no especificado.' }
  const data = campos(formData)
  if (data.nombre.length < 2) return { error: 'El nombre es obligatorio.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('proveedores').update(data).eq('id', id)
  if (error) return { error: traducir(error.message) }

  revalidatePath('/proveedores')
  return { ok: true }
}

export async function eliminarProveedor(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('proveedores').update({ activo: false }).eq('id', id)
  revalidatePath('/proveedores')
}
