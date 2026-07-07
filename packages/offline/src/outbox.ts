import type { Sb, PushHandler, OutboxItem, Row } from './types'
import type { StorageAdapter } from './store'

function uuid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)
}

function ahora(): string {
  // El llamador puede pasar la fecha; aquí usamos Date (runtime app, permitido).
  return new Date().toISOString()
}

/**
 * Registra un cambio local: escribe optimista en el store y encola el intent
 * para enviarlo cuando haya conexión.
 */
export async function encolar(
  store: StorageAdapter,
  kind: string,
  payload: Record<string, unknown>,
  optimista?: { tabla: string; row: Row },
): Promise<void> {
  if (optimista) await store.bulkPut(optimista.tabla, [optimista.row])
  const item: OutboxItem = { id: uuid(), kind, payload, ts: ahora(), intentos: 0 }
  await store.addOutbox(item)
}

/**
 * Registro de manejadores de push por tipo de intent. La app registra cómo se
 * sube cada operación (upsert directo, RPC, etc.).
 */
export class PushRegistry {
  private handlers = new Map<string, PushHandler>()
  on(kind: string, handler: PushHandler): this { this.handlers.set(kind, handler); return this }
  get(kind: string): PushHandler | undefined { return this.handlers.get(kind) }
}

/** Manejadores genéricos reutilizables. */
export function upsertHandler(tabla: string): PushHandler {
  return async (sb: Sb, payload: Record<string, unknown>) => {
    const { error } = await sb.from(tabla).upsert(payload)
    if (error) throw new Error(error.message)
  }
}

export function rpcHandler(fn: string): PushHandler {
  return async (sb: Sb, payload: Record<string, unknown>) => {
    const { error } = await sb.rpc(fn, payload)
    if (error) throw new Error(error.message)
  }
}

/** UPDATE parcial por id (para editar campos sueltos sin violar NOT NULL). */
export function updateHandler(tabla: string): PushHandler {
  return async (sb: Sb, payload: Record<string, unknown>) => {
    const { id, ...rest } = payload
    const { error } = await sb.from(tabla).update(rest).eq('id', id)
    if (error) throw new Error(error.message)
  }
}
