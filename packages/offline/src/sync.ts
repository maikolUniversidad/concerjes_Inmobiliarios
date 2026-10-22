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

/** PULL de una lista de tablas. */
export async function pullTablas(
  sb: Sb, store: StorageAdapter, defs: TablaSync[],
  onProgress?: (tabla: string, n: number) => void,
): Promise<Record<string, number>> {
  const res: Record<string, number> = {}
  for (const def of defs) {
    const n = await pullTabla(sb, store, def)
    res[def.tabla] = n
    onProgress?.(def.tabla, n)
  }
  return res
}

/** PULL de todas las tablas configuradas por defecto (las del inventario). */
export async function pullTodo(
  sb: Sb, store: StorageAdapter,
  onProgress?: (tabla: string, n: number) => void,
): Promise<Record<string, number>> {
  return pullTablas(sb, store, TABLAS_SYNC, onProgress)
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

/**
 * PUSH respetando el ORDEN dentro de cada grupo.
 *
 * `pushOutbox()` recorre la cola y, si un intent falla, sigue con el
 * siguiente. Para los intents sueltos del inventario eso está bien. Para una
 * visita de ronda NO: si falla el intent que crea la visita, los que cuelgan de
 * ella van a fallar todos, y si falla una evidencia y el cierre sí pasa, la
 * visita queda INCOMPLETA por un problema de red (los mínimos de foto los
 * valida el cierre). Así que en cuanto uno falla, el resto de SU grupo se deja
 * para la próxima sincronización; los otros grupos siguen.
 *
 * Los intents sin grupo se mandan como siempre, cada uno por su cuenta.
 */
export async function pushOutboxPorGrupo(
  sb: Sb, store: StorageAdapter, registry: PushRegistry,
): Promise<{ pushed: number; errores: string[]; gruposDetenidos: string[] }> {
  const items = (await store.getOutbox()).slice().sort((a, b) => {
    const ga = a.grupo ?? ''
    const gb = b.grupo ?? ''
    if (ga !== gb) return ga.localeCompare(gb)
    const oa = a.orden ?? 0
    const ob = b.orden ?? 0
    if (oa !== ob) return oa - ob
    return a.ts.localeCompare(b.ts)
  })

  const errores: string[] = []
  const detenidos = new Set<string>()
  let pushed = 0

  for (const item of items) {
    if (item.grupo && detenidos.has(item.grupo)) continue
    const handler = registry.get(item.kind)
    if (!handler) {
      errores.push(`Sin manejador para "${item.kind}"`)
      if (item.grupo) detenidos.add(item.grupo)
      continue
    }
    try {
      await handler(sb, item.payload)
      await store.removeOutbox(item.id)
      pushed++
    } catch (e) {
      errores.push(`${item.kind}: ${e instanceof Error ? e.message : 'error'}`)
      // Se queda en el outbox para reintentar, y su grupo se detiene aquí.
      if (item.grupo) detenidos.add(item.grupo)
    }
  }
  return { pushed, errores, gruposDetenidos: [...detenidos] }
}
