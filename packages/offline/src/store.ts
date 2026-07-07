import type { Row, OutboxItem } from './types'

/**
 * Almacenamiento local abstracto. La app usará una implementación con Dexie
 * (IndexedDB); las pruebas usan la in-memory. El motor de sync solo depende de
 * esta interfaz.
 */
export interface StorageAdapter {
  bulkPut(tabla: string, rows: Row[]): Promise<void>
  getAll(tabla: string): Promise<Row[]>
  get(tabla: string, id: string): Promise<Row | undefined>
  count(tabla: string): Promise<number>

  getMeta(key: string): Promise<string | undefined>
  setMeta(key: string, val: string): Promise<void>

  addOutbox(item: OutboxItem): Promise<void>
  getOutbox(): Promise<OutboxItem[]>
  removeOutbox(id: string): Promise<void>
}

/** Implementación en memoria (pruebas / SSR). */
export class InMemoryStore implements StorageAdapter {
  private tablas = new Map<string, Map<string, Row>>()
  private meta = new Map<string, string>()
  private outbox: OutboxItem[] = []

  private t(tabla: string): Map<string, Row> {
    let m = this.tablas.get(tabla)
    if (!m) { m = new Map(); this.tablas.set(tabla, m) }
    return m
  }

  async bulkPut(tabla: string, rows: Row[]): Promise<void> {
    const m = this.t(tabla)
    for (const r of rows) m.set(r.id, r)
  }
  async getAll(tabla: string): Promise<Row[]> { return [...this.t(tabla).values()] }
  async get(tabla: string, id: string): Promise<Row | undefined> { return this.t(tabla).get(id) }
  async count(tabla: string): Promise<number> { return this.t(tabla).size }

  async getMeta(key: string): Promise<string | undefined> { return this.meta.get(key) }
  async setMeta(key: string, val: string): Promise<void> { this.meta.set(key, val) }

  async addOutbox(item: OutboxItem): Promise<void> { this.outbox.push(item) }
  async getOutbox(): Promise<OutboxItem[]> { return [...this.outbox] }
  async removeOutbox(id: string): Promise<void> { this.outbox = this.outbox.filter(o => o.id !== id) }
}
