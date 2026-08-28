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
  // Hay sesión pero no hay perfil (o no se pudo leer): sin permisos. Antes se
  // devolvía `sinGating: true`, que daba acceso total y permitía saltarse todo
  // el filtro de la app; la BD igual lo frena, pero la UI mostraba de más.
  if (!u) return construir('', {}, false)

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

/** Mensaje estándar cuando falta un permiso (mismo texto en toda la app). */
export const SIN_PERMISO =
  'No tienes permiso para esta acción. Pide a un administrador que lo habilite en Roles y Permisos.'

/**
 * Guard para server actions: devuelve el mensaje de error si NO se tiene
 * ninguno de los permisos indicados, o `null` si sí se puede.
 *
 *   const falta = await faltaPermiso('editar_productos')
 *   if (falta) return { error: falta }
 *
 * Es la contraparte de `requirePermiso` para acciones (que devuelven `{error}`
 * en vez de redirigir) y evita depender solo de RLS, cuyo mensaje crudo
 * ("row-level security") no le dice nada al usuario.
 */
export async function faltaPermiso(...permisos: string[]): Promise<string | null> {
  const p = await getPermisosUsuario()
  return permisos.some((x) => p.puede(x)) ? null : SIN_PERMISO
}
