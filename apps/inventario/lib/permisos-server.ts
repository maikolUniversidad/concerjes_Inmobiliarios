import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface PermisosUsuario {
  rol: string
  permisos: Record<string, boolean>
  esSuperAdmin: boolean
  sinGating: boolean
  /** ¿El usuario tiene el permiso? (misma lógica que el provider de cliente). */
  puede: (permiso?: string) => boolean
}

function construir(rol: string, permisos: Record<string, boolean>, sinGating: boolean): PermisosUsuario {
  const esSuperAdmin = rol === 'SUPER_ADMIN'
  // SUPER_ADMIN y ADMIN: acceso completo implícito. El resto por sus permisos.
  const bypass = sinGating || esSuperAdmin || rol === 'ADMIN'
  const puede = (permiso?: string) => !permiso || bypass || !!permisos[permiso]
  return { rol, permisos, esSuperAdmin, sinGating, puede }
}

/**
 * Permisos efectivos del usuario autenticado (rol + overrides).
 * Cacheado por request: varias llamadas en el mismo render = 1 sola consulta.
 */
export const getPermisosUsuario = cache(async (): Promise<PermisosUsuario> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return construir('', {}, true)

  const { data } = await supabase
    .from('usuarios')
    .select('rol, permisos, roles(permisos)')
    .eq('id', user.id)
    .single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = data as any
  if (!u) return construir('', {}, true) // sin perfil → no bloquear

  const permisos = { ...(u.roles?.permisos ?? {}), ...(u.permisos ?? {}) }
  return construir(u.rol ?? '', permisos, false)
})

/**
 * Guard para páginas server: si el usuario no tiene el permiso, redirige.
 * Uso: `await requirePermiso('ver_personas')` al inicio del componente de página.
 */
export async function requirePermiso(permiso: string, redirectTo = '/dashboard'): Promise<PermisosUsuario> {
  const p = await getPermisosUsuario()
  if (!p.puede(permiso)) redirect(redirectTo)
  return p
}
