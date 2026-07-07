import type { Sb, Row, TablaSync, SyncResult } from './types'
import type { StorageAdapter } from './store'
import type { PushRegistry } from './outbox'
import { TABLAS_SYNC, watermarkCol, EPOCH } from './schema'

const PAGE = 1000
const MAX_PAGINAS = 50

function wmKey(tabla: string): string { return `wm:${tabla}` }

/**
 * PULL de una tabla: trae filas con watermark > última marca conocida, hace
 * upsert local y avanza el watermark. Pagina por si hay muchas filas.
 */
export async function pullTabla(sb: Sb, store: StorageAdapter, def: TablaSync): Promise<number> {
  const col = watermarkCol(def)
  let wm = def.modo === 'full' ? EPOCH : (await store.getMeta(wmKey(def.tabla))) ?? EPOCH
  let total = 0

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let q = sb.from(def.tabla).select('*')
    if (def.modo !== 'full') q = q.gt(col, wm)
    q = q.order(col, { ascending: true }).limit(PAGE)

    const { data, error } = await q
    if (error) throw new Error(`${def.tabla}: ${error.message}`)
    const rows = (data ?? []) as Row[]
    if (rows.length === 0) break

    await store.bulkPut(def.tabla, rows)
    total += rows.length

    const ultima = rows[rows.length - 1][col]
    if (typeof ultima === 'string' && def.modo !== 'full') wm = ultima

    if (rows.length < PAGE) break
  }

  if (def.modo !== 'full') await store.setMeta(wmKey(def.tabla), wm)
  return total
}

/** PULL de todas las tablas configuradas. */
export async function pullTodo(
  sb: Sb, store: StorageAdapter,
  onProgress?: (tabla: string, n: number) => void,
): Promise<Record<string, number>> {
  const res: Record<string, number> = {}
  for (const def of TABLAS_SYNC) {
    const n = await pullTabla(sb, store, def)
    res[def.tabla] = n
    onProgress?.(def.tabla, n)
  }
  return res
}

/** PUSH del outbox: reproduce cada intent contra el servidor. */
export async function pushOutbox(sb: Sb, store: StorageAdapter, registry: PushRegistry): Promise<{ pushed: number; errores: string[] }> {
  const items = await store.getOutbox()
  const errores: string[] = []
  let pushed = 0
  for (const item of items) {
    const handler = registry.get(item.kind)
    if (!handler) { errores.push(`Sin manejador para "${item.kind}"`); continue }
    try {
      await handler(sb, item.payload)
      await store.removeOutbox(item.id)
      pushed++
    } catch (e) {
      errores.push(`${item.kind}: ${e instanceof Error ? e.message : 'error'}`)
      // Se deja en el outbox para reintentar en la próxima sync.
    }
  }
  return { pushed, errores }
}

/** Sincronización completa: primero sube lo pendiente, luego baja lo nuevo. */
export async function sincronizar(
  sb: Sb, store: StorageAdapter, registry: PushRegistry,
  onProgress?: (tabla: string, n: number) => void,
): Promise<SyncResult> {
  const { pushed, errores } = await pushOutbox(sb, store, registry)
  const pulled = await pullTodo(sb, store, onProgress)
  return { pulled, pushed, errores }
}
