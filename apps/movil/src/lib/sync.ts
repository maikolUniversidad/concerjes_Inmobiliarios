import { PushRegistry, upsertHandler, updateHandler, rpcHandler, sincronizar, type Sb, type SyncResult } from '@conserjes/offline'
import { supabase } from './supabase'
import { store } from './db'

// Manejadores de push: cómo se sube cada intent cuando hay conexión.
export const registry = new PushRegistry()
registry.on('upsert:productos', upsertHandler('productos'))
registry.on('update:productos', updateHandler('productos'))
registry.on('upsert:proveedores', upsertHandler('proveedores'))
registry.on('update:proveedores', updateHandler('proveedores'))
registry.on('upsert:ubicaciones', upsertHandler('ubicaciones'))
registry.on('movimiento', rpcHandler('registrar_movimiento'))

export function estaEnLinea(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

/** Sincroniza todo (sube outbox, baja cambios). Requiere conexión. */
export async function sincronizarTodo(onProgress?: (tabla: string, n: number) => void): Promise<SyncResult> {
  return sincronizar(supabase as unknown as Sb, store, registry, onProgress)
}
