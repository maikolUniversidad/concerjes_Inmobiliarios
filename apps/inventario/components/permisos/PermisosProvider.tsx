'use client'

import { createContext, useContext, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export interface PermisosCtx {
  /** Permisos efectivos (permisos del rol + overrides del usuario). */
  permisos: Record<string, boolean>
  /** Rol enum del usuario (para bypass de super admin). */
  rol: string
  esSuperAdmin: boolean
  /** Si es true, no se aplica ningún filtro (fallback de seguridad). */
  sinGating: boolean
  /** ¿El usuario tiene el permiso indicado? */
  puede: (permiso?: string) => boolean
}

const Ctx = createContext<PermisosCtx | null>(null)

interface ProviderProps {
  permisos: Record<string, boolean>
  rol: string
  sinGating?: boolean
  children: React.ReactNode
}

export function PermisosProvider({ permisos, rol, sinGating = false, children }: ProviderProps) {
  const value = useMemo<PermisosCtx>(() => {
    const esSuperAdmin = rol === 'SUPER_ADMIN'
    // SUPER_ADMIN y ADMIN son gestores del sistema: acceso completo implícito.
    // El resto de roles se filtra por sus permisos configurados en /roles.
    const bypass = sinGating || esSuperAdmin || rol === 'ADMIN'
    const puede = (permiso?: string) => {
      if (!permiso) return true          // ítems sin permiso: siempre visibles
      if (bypass) return true
      return !!permisos[permiso]
    }
    return { permisos, rol, esSuperAdmin, sinGating, puede }
  }, [permisos, rol, sinGating])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePermisos(): PermisosCtx {
  const ctx = useContext(Ctx)
  // Fallback defensivo si algún componente se usa fuera del provider.
  if (!ctx) {
    return { permisos: {}, rol: '', esSuperAdmin: false, sinGating: true, puede: () => true }
  }
  return ctx
}

/** Envoltorio declarativo: muestra a sus hijos solo si se tiene el permiso. */
export function Can({ permiso, children }: { permiso: string; children: React.ReactNode }) {
  const { puede } = usePermisos()
  return puede(permiso) ? <>{children}</> : null
}

/**
 * Guard de cliente para páginas client-component: si no se tiene el permiso,
 * redirige. Los permisos llegan por SSR, así que `ok` es correcto en el primer
 * render (sin flash de contenido si el componente hace `if (!ok) return null`).
 */
export function useRequierePermiso(permiso: string, redirectTo = '/dashboard'): boolean {
  const { puede } = usePermisos()
  const router = useRouter()
  const ok = puede(permiso)
  useEffect(() => {
    if (!ok) router.replace(redirectTo)
  }, [ok, router, redirectTo])
  return ok
}
