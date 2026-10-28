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
 *
 * El id sale de `getClaims()` y no de `getUser()`. `getUser()` es un viaje de
 * red al servidor de Auth, y esto corre en CADA render de página; `getClaims()`
 * verifica la firma del JWT en local contra el JWKS del proyecto, que usa
 * llaves asimétricas ES256. El JWKS se guarda en una caché de módulo con TTL de
 * 10 minutos, así que aunque aquí se cree un cliente nuevo por petición, se
 * paga a lo sumo un fetch cada 10 min por instancia en vez de uno por render.
 *
 * Por qué no debilita nada: lo único que se saca del token es el `sub`, para
 * leer la fila propia de `usuarios`; todo lo que se decide después lo decide la
 * RLS en la base con ESE MISMO JWT. Lo que `getUser()` añade —ver si la sesión
 * fue revocada del lado del servidor— no llega a la capa de datos: PostgREST
 * valida la firma del token en local y no le pregunta al servidor de Auth, así
 * que un token revocado pero no vencido ya pasa hoy en cualquier consulta de
 * datos. O sea que quitarlo de aquí no abre ninguna ventana nueva: deja de
 * pagar un viaje de red por una comprobación que la capa de datos tampoco hace.
 * Y a diferencia de `getSession()`, `getClaims()` sí rechaza un token forjado,
 * alterado o vencido.
 *
 * Los `getUser()` de las server actions se quedan como están: son uno por
 * mutación —no uno por render—, ahí el viaje es barato comparado con lo que
 * cuida, y es donde ocurre la escritura.
 */
export const getPermisosUsuario = cache(async (): Promise<PermisosUsuario> => {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) return construir('', {}, true)

  const { data } = await supabase
    .from('usuarios')
    .select('rol, permisos, roles(permisos)')
    .eq('id', userId)
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
