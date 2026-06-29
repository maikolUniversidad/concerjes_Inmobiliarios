'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { RolUsuario } from '@/lib/types/database'

export interface ActionResult { error?: string; ok?: boolean }

const ROLES: RolUsuario[] = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORDINADOR_COMPRAS', 'BODEGUERO', 'AUDITOR', 'OPERADOR_SEDE']

export async function actualizarUsuario(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Usuario no especificado.' }

  const rol = String(formData.get('rol') ?? '') as RolUsuario
  if (!ROLES.includes(rol)) return { error: 'Rol inválido.' }

  const patch = {
    rol,
    grupo_id: String(formData.get('grupo_id') ?? '') || null,
    sede_id: String(formData.get('sede_id') ?? '') || null,
    activo: formData.get('activo') === 'on',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('usuarios').update(patch).eq('id', id)
  if (error) {
    if (error.message.includes('row-level security')) return { error: 'No tienes permisos (requiere Admin).' }
    return { error: 'Operación fallida: ' + error.message }
  }
  revalidatePath('/usuarios')
  return { ok: true }
}

export async function invitarUsuario(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // Solo Admin/Super Admin pueden invitar
  const { data: yo } = await supabase.from('usuarios').select('rol').eq('id', user.id).single()
  const miRol = (yo as { rol: RolUsuario } | null)?.rol
  if (miRol !== 'ADMIN' && miRol !== 'SUPER_ADMIN') return { error: 'Solo un administrador puede invitar usuarios.' }

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const rol = String(formData.get('rol') ?? 'AUDITOR') as RolUsuario
  if (!email.includes('@')) return { error: 'Email inválido.' }
  if (nombre.length < 3) return { error: 'El nombre es obligatorio.' }
  if (password.length < 8) return { error: 'La contraseña temporal debe tener al menos 8 caracteres.' }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nombre },
  })
  if (createErr) {
    if (createErr.message.toLowerCase().includes('already')) return { error: 'Ya existe un usuario con ese email.' }
    return { error: 'No se pudo crear el usuario: ' + createErr.message }
  }

  // El trigger handle_new_user ya creó la fila en `usuarios`; ajustamos rol y nombre.
  const nuevoId = created.user?.id
  if (nuevoId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('usuarios').update({ rol, nombre }).eq('id', nuevoId)
  }

  revalidatePath('/usuarios')
  return { ok: true }
}
