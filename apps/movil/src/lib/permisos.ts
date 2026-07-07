import { db } from './db'

// Permisos evaluados sin conexión desde la copia local (Dexie) de `usuarios` y
// `roles`. Espejo de la lógica del layout de la web.

export interface PermisosState {
  permisos: Record<string, boolean>
  rol: string
  sinGating: boolean
}

export const SIN_GATING: PermisosState = { permisos: {}, rol: '', sinGating: true }

interface UsuarioLocal { rol?: string; rol_id?: string | null; permisos?: Record<string, boolean> | null }
interface RolLocal { permisos?: Record<string, boolean> | null }

export async function cargarPermisos(userId: string): Promise<PermisosState> {
  const u = (await db.table('usuarios').get(userId)) as UsuarioLocal | undefined
  if (!u) return SIN_GATING // aún no sincronizado / sin perfil → no bloquear
  let rolePerms: Record<string, boolean> = {}
  if (u.rol_id) {
    const r = (await db.table('roles').get(u.rol_id)) as RolLocal | undefined
    rolePerms = r?.permisos ?? {}
  }
  const permisos = { ...rolePerms, ...(u.permisos ?? {}) }
  const sinGating = u.rol === 'SUPER_ADMIN' || Object.keys(permisos).length === 0
  return { permisos, rol: u.rol ?? '', sinGating }
}

export function tiene(state: PermisosState, key: string): boolean {
  return state.sinGating || state.permisos[key] === true
}

// Mapa pestaña → permiso de lectura
export const TAB_PERMISO: Record<string, string> = {
  productos: 'ver_productos',
  stock: 'ver_stock',
  movimientos: 'ver_movimientos',
  bodegas: 'ver_bodegas',
  arqueo: 'ver_arqueo',
}
