'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult { error?: string; ok?: boolean }

export async function crearProveedor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (nombre.length < 2) return { error: 'El nombre es obligatorio.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('proveedores').insert({
    nombre,
    nit: String(formData.get('nit') ?? '').trim() || null,
    contacto: String(formData.get('contacto') ?? '').trim() || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    es_principal: formData.get('es_principal') === 'on',
  })

  if (error) {
    if (error.message.includes('row-level security')) return { error: 'No tienes permisos (requiere Admin o Coord. Compras).' }
    if (error.message.includes('duplicate')) return { error: 'Ya existe un proveedor con ese NIT.' }
    return { error: 'No se pudo crear: ' + error.message }
  }

  revalidatePath('/proveedores')
  return { ok: true }
}
