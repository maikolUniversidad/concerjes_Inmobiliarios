// Almacenamiento local de la PWA del trabajador: IndexedDB, a mano.
//
// Implementa `StorageAdapter` y `MedioStore` de `@conserjes/offline`, así que el
// motor de cola es el mismo que usa `apps/movil` (ADR-D: no se escribe una cola
// nueva). Lo que NO se usa es Dexie: `apps/movil` lo tiene, pero meterlo en la
// consola web agrega ~70 KB al bundle de TODA la aplicación —se carga una vez
// por sesión en celulares de gama baja con datos prepagados— para guardar seis
// tablas con llave simple. Esto son 120 líneas sin dependencias.
//
// Qué se guarda:
//   · `visitas` — la visita local completa (respuestas, evidencia, firmas). Es
//     lo que permite terminar una ronda en un sótano y cerrarla ahí mismo;
//   · `outbox` — los intents pendientes, en orden;
//   · `medios` — los archivos con su sha256, pendientes de subir;
//   · `meta` — watermarks de la sincronización y la sesión actual;
//   · las tablas de solo lectura que `TABLAS_SYNC_RONDAS` replica.

import type { OutboxItem, Row } from '@conserjes/offline'
import type { MedioPendiente } from '@conserjes/offline'

const BD = 'ronda-campo'
const VERSION = 1
const TIENDAS = ['tablas', 'outbox', 'medios', 'meta', 'visitas'] as const

let _db: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  if (_db) return _db
  _db = new Promise((resolver, rechazar) => {
    if (typeof indexedDB === 'undefined') {
      rechazar(new Error('Este navegador no guarda datos sin conexión.'))
      return
    }
    const req = indexedDB.open(BD, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const t of TIENDAS) {
        if (!db.objectStoreNames.contains(t)) db.createObjectStore(t)
      }
    }
    req.onsuccess = () => resolver(req.result)
    req.onerror = () => rechazar(req.error ?? new Error('No se pudo abrir el almacenamiento local'))
  })
  return _db
}

function tx<T>(
  tienda: (typeof TIENDAS)[number],
  modo: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return abrir().then((db) => new Promise<T>((resolver, rechazar) => {
    const t = db.transaction(tienda, modo)
    const req = fn(t.objectStore(tienda))
    req.onsuccess = () => resolver(req.result)
    req.onerror = () => rechazar(req.error ?? new Error('Error de IndexedDB'))
  }))
}

const clave = (tabla: string, id: string) => `${tabla}:${id}`

/** Store local de la PWA. Cumple `StorageAdapter` y `MedioStore`. */
export const almacen = {
  // ── StorageAdapter ────────────────────────────────────────────────────────
  async bulkPut(tabla: string, rows: Row[]): Promise<void> {
    const db = await abrir()
    await new Promise<void>((resolver, rechazar) => {
      const t = db.transaction('tablas', 'readwrite')
      const s = t.objectStore('tablas')
      for (const r of rows) s.put(r, clave(tabla, String(r.id)))
      t.oncomplete = () => resolver()
      t.onerror = () => rechazar(t.error ?? new Error('Error al guardar'))
    })
  },

  async getAll(tabla: string): Promise<Row[]> {
    const db = await abrir()
    return new Promise((resolver, rechazar) => {
      const out: Row[] = []
      const t = db.transaction('tablas', 'readonly')
      const req = t.objectStore('tablas')
        .openCursor(IDBKeyRange.bound(`${tabla}:`, `${tabla}:￿`))
      req.onsuccess = () => {
        const c = req.result
        if (!c) { resolver(out); return }
        out.push(c.value as Row)
        c.continue()
      }
      req.onerror = () => rechazar(req.error ?? new Error('Error al leer'))
    })
  },

  async get(tabla: string, id: string): Promise<Row | undefined> {
    return tx<Row | undefined>('tablas', 'readonly', (s) => s.get(clave(tabla, id)))
  },

  async count(tabla: string): Promise<number> {
    return (await almacen.getAll(tabla)).length
  },

  async getMeta(key: string): Promise<string | undefined> {
    return tx<string | undefined>('meta', 'readonly', (s) => s.get(key))
  },

  async setMeta(key: string, val: string): Promise<void> {
    await tx('meta', 'readwrite', (s) => s.put(val, key))
  },

  async addOutbox(item: OutboxItem): Promise<void> {
    await tx('outbox', 'readwrite', (s) => s.put(item, item.id))
  },

  async getOutbox(): Promise<OutboxItem[]> {
    const db = await abrir()
    return new Promise((resolver, rechazar) => {
      const req = db.transaction('outbox', 'readonly').objectStore('outbox').getAll()
      req.onsuccess = () => resolver((req.result ?? []) as OutboxItem[])
      req.onerror = () => rechazar(req.error ?? new Error('Error al leer la cola'))
    })
  },

  async removeOutbox(id: string): Promise<void> {
    await tx('outbox', 'readwrite', (s) => s.delete(id))
  },

  // ── MedioStore ────────────────────────────────────────────────────────────
  async addMedio(m: MedioPendiente): Promise<void> {
    await tx('medios', 'readwrite', (s) => s.put(m, m.id))
  },

  async getMedios(grupo?: string): Promise<MedioPendiente[]> {
    const db = await abrir()
    const todos = await new Promise<MedioPendiente[]>((resolver, rechazar) => {
      const req = db.transaction('medios', 'readonly').objectStore('medios').getAll()
      req.onsuccess = () => resolver((req.result ?? []) as MedioPendiente[])
      req.onerror = () => rechazar(req.error ?? new Error('Error al leer los medios'))
    })
    return grupo ? todos.filter((m) => m.grupo === grupo) : todos
  },

  async putMedio(m: MedioPendiente): Promise<void> {
    await tx('medios', 'readwrite', (s) => s.put(m, m.id))
  },

  async removeMedio(id: string): Promise<void> {
    await tx('medios', 'readwrite', (s) => s.delete(id))
  },

  // ── Visitas locales ───────────────────────────────────────────────────────
  // La visita en curso vive aquí hasta que el servidor la confirma. Se guarda
  // completa y en cada cambio: si el navegador se cierra (una llamada entrante
  // mata la pestaña en un celular de gama baja), al volver está todo.
  async guardarVisita<T extends { id: string }>(v: T): Promise<void> {
    await tx('visitas', 'readwrite', (s) => s.put(v, v.id))
  },

  async leerVisita<T>(id: string): Promise<T | undefined> {
    return tx<T | undefined>('visitas', 'readonly', (s) => s.get(id))
  },

  async visitas<T>(): Promise<T[]> {
    const db = await abrir()
    return new Promise((resolver, rechazar) => {
      const req = db.transaction('visitas', 'readonly').objectStore('visitas').getAll()
      req.onsuccess = () => resolver((req.result ?? []) as T[])
      req.onerror = () => rechazar(req.error ?? new Error('Error al leer las visitas'))
    })
  },

  async borrarVisita(id: string): Promise<void> {
    await tx('visitas', 'readwrite', (s) => s.delete(id))
  },
}

/** ¿Este navegador puede guardar la visita sin conexión? Si no, la PWA lo dice
 *  en vez de dejar que alguien haga una ronda que se va a perder. */
export function hayAlmacenamiento(): boolean {
  return typeof indexedDB !== 'undefined'
}
