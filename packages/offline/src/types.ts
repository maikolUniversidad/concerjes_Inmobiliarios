// Tipos base del motor offline. Framework-agnóstico y sin dependencia dura de
// @supabase/supabase-js: el cliente se pasa como `Sb` (estructural).

export interface Row { id: string; [k: string]: unknown }

/** Interfaz mínima del cliente Supabase que necesita el motor. */
export interface Sb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabla: string): any
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

/** Cómo se sincroniza cada tabla. */
export type SyncMode =
  | 'incremental' // trae filas con updated_at > watermark (soporta inserts + updates)
  | 'append'      // trae filas con created_at > watermark (solo inserts; p.ej. ledger)
  | 'full'        // trae toda la tabla en cada sync (tablas pequeñas sin timestamp)

export interface TablaSync {
  tabla: string
  modo: SyncMode
  /** Columna watermark. Por defecto 'updated_at' (o 'created_at' en modo append). */
  tsCol?: string
}

/** Un cambio local pendiente de enviar al servidor (cola offline). */
export interface OutboxItem {
  id: string
  kind: string                          // p.ej. 'upsert:productos', 'movimiento'
  payload: Record<string, unknown>
  ts: string
  intentos?: number
}

/** Manejador que sube un intent al servidor cuando hay conexión. */
export type PushHandler = (sb: Sb, payload: Record<string, unknown>) => Promise<void>

export interface SyncResult {
  pulled: Record<string, number>
  pushed: number
  errores: string[]
}
