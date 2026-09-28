// Orden único de las exportaciones y reportes en Excel.
//
// Regla del negocio: todo archivo sale "por orden de ítem y alfabético":
//   1. por ítem (productos.codigo) ascendente, los productos sin ítem al final;
//   2. a igual ítem (o sin ítem), por nombre en orden alfabético español
//      (sin distinguir mayúsculas ni tildes: "Ácido" va junto a "acido").
// Donde no hay producto (usuarios, proveedores, sedes…) se ordena
// alfabéticamente por el nombre principal de la fila.
//
// Sin dependencias de Next ni de Supabase: se puede usar en cliente, en rutas
// de servidor y en scripts de verificación.

const COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/** Comparación alfabética en español (sin mayúsculas ni tildes); vacíos al final. */
export function compararTexto(a: unknown, b: unknown): number {
  const ta = a === null || a === undefined ? '' : String(a).trim()
  const tb = b === null || b === undefined ? '' : String(b).trim()
  if (ta === '' && tb !== '') return 1
  if (tb === '' && ta !== '') return -1
  // Rótulos de relleno como "(sin proveedor)" o "(sin dato)" van al final.
  const ra = ta.startsWith('('), rb = tb.startsWith('(')
  if (ra !== rb) return ra ? 1 : -1
  return COLLATOR.compare(ta, tb)
}

/** Convierte el ítem a número; null si no hay o no es numérico. */
export function numeroItem(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

/** Comparación por ítem ascendente (nulos al final) y luego por nombre. */
export function compararItem(
  codigoA: unknown, nombreA: unknown,
  codigoB: unknown, nombreB: unknown,
): number {
  const ca = numeroItem(codigoA)
  const cb = numeroItem(codigoB)
  if (ca !== null && cb !== null && ca !== cb) return ca - cb
  if (ca === null && cb !== null) return 1
  if (cb === null && ca !== null) return -1
  if (ca === null && cb === null) {
    // Ítems no numéricos (p. ej. "A-12"): se comparan como texto natural.
    const c = compararTexto(codigoA, codigoB)
    if (c !== 0 && (codigoA ?? '') !== '' && (codigoB ?? '') !== '') return c
  }
  return compararTexto(nombreA, nombreB)
}

/**
 * Devuelve una copia ordenada por ítem y nombre. El orden es estable: a igual
 * ítem y nombre se conserva el orden de entrada (útil para dejar, p. ej., los
 * movimientos de un mismo producto del más reciente al más antiguo).
 */
export function ordenarPorItem<T>(
  filas: readonly T[],
  getCodigo: (f: T) => unknown,
  getNombre: (f: T) => unknown,
): T[] {
  return filas
    .map((f, i) => ({ f, i }))
    .sort((a, b) =>
      compararItem(getCodigo(a.f), getNombre(a.f), getCodigo(b.f), getNombre(b.f)) || a.i - b.i)
    .map(x => x.f)
}

/** Copia ordenada alfabéticamente por una o varias llaves de texto (estable). */
export function ordenarAlfabetico<T>(filas: readonly T[], ...llaves: ((f: T) => unknown)[]): T[] {
  return filas
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      for (const k of llaves) {
        const c = compararTexto(k(a.f), k(b.f))
        if (c !== 0) return c
      }
      return a.i - b.i
    })
    .map(x => x.f)
}

// ─── Filas genéricas (objetos planos) ─────────────────────────────────────────

type Plana = Record<string, unknown>

/** Llaves con que se reconoce el ítem y el nombre del producto en una fila plana. */
const LLAVES_ITEM = ['codigo', 'producto_codigo', 'item', 'ítem']
const LLAVES_NOMBRE_PRODUCTO = ['nombre_estandar', 'producto', 'producto_nombre']
/** Nombre principal de filas que no son de producto, en orden de preferencia. */
const LLAVES_NOMBRE = [
  'nombre', 'nombre_estandar', 'razon_social', 'grupo', 'proveedor', 'sede', 'titulo',
  'usuario_nombre', 'usuario', 'numero_oc', 'numero', 'orden', 'oc', 'tabla', 'entidad',
  'email', 'usuario_email', 'periodo', 'clave',
]

function primeraLlave(fila: Plana, llaves: string[]): string | null {
  for (const k of llaves) if (k in fila) return k
  return null
}

/**
 * Ordena filas planas sin saber de antemano de qué tabla vienen:
 * si traen ítem de producto → por ítem y nombre; si no, alfabético por el
 * nombre principal. Devuelve también el criterio usado (para notas).
 */
export function ordenarFilasPlanas<T extends Plana>(filas: readonly T[]): { filas: T[]; criterio: string } {
  if (filas.length === 0) return { filas: [...filas], criterio: '' }
  const muestra = filas[0]
  const kItem = primeraLlave(muestra, LLAVES_ITEM)
  const kNombreProd = primeraLlave(muestra, LLAVES_NOMBRE_PRODUCTO)
  if (kItem && kNombreProd) {
    return {
      filas: ordenarPorItem(filas, f => f[kItem], f => f[kNombreProd]),
      criterio: `ítem (${kItem}) y ${kNombreProd}`,
    }
  }
  const kNombre = primeraLlave(muestra, LLAVES_NOMBRE)
  if (kNombre) return { filas: ordenarAlfabetico(filas, f => f[kNombre]), criterio: kNombre }
  return { filas: [...filas], criterio: '' }
}
