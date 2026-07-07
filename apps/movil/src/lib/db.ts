import Dexie from 'dexie'
import { TABLAS_SYNC, watermarkCol, type StorageAdapter, type Row, type OutboxItem } from '@conserjes/offline'

// Base local en IndexedDB. Cada tabla sincronizable se declara con PK `id` e
// índice por su columna watermark. Más `_meta` (watermarks) y `_outbox` (cola).
class LocalDB extends Dexie {
  constructor() {
    super('conserjes-inventario')
    const stores: Record<string, string> = { _meta: 'key', _outbox: 'id' }
    for (const t of TABLAS_SYNC) stores[t.tabla] = `id, ${watermarkCol(t)}`
    this.version(1).stores(stores)
  }
}

export const db = new LocalDB()

/** Adaptador de almacenamiento del motor offline sobre Dexie. */
export class DexieStore implements StorageAdapter {
  async bulkPut(tabla: string, rows: Row[]): Promise<void> { await db.table(tabla).bulkPut(rows) }
  async getAll(tabla: string): Promise<Row[]> { return (await db.table(tabla).toArray()) as Row[] }
  async get(tabla: string, id: string): Promise<Row | undefined> { return (await db.table(tabla).get(id)) as Row | undefined }
  async count(tabla: string): Promise<number> { return db.table(tabla).count() }

  async getMeta(key: string): Promise<string | undefined> {
    const r = (await db.table('_meta').get(key)) as { key: string; val: string } | undefined
    return r?.val
  }
  async setMeta(key: string, val: string): Promise<void> { await db.table('_meta').put({ key, val }) }

  async addOutbox(item: OutboxItem): Promise<void> { await db.table('_outbox').put(item) }
  async getOutbox(): Promise<OutboxItem[]> { return (await db.table('_outbox').toArray()) as OutboxItem[] }
  async removeOutbox(id: string): Promise<void> { await db.table('_outbox').delete(id) }
}

export const store = new DexieStore()

/** Borra toda la base local (p.ej. al cerrar sesión). */
export async function limpiarLocal(): Promise<void> {
  await db.delete()
  location.reload()
}
