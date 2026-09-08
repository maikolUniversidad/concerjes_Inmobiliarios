// Preferencias de filtro ("vistas rápidas"): combinaciones de filtros que la
// persona guarda con un nombre para volver a aplicarlas de un clic. Viven en
// localStorage por ámbito (normalmente la ruta del módulo), porque son una
// comodidad personal del navegador y no un dato del negocio.

export interface PreferenciaFiltro {
  id: string
  nombre: string
  /** Filtros de la preferencia como pares clave/valor de la URL. */
  filtros: Record<string, string>
}

const PREFIJO = 'filtros:pref:'
export const MAX_PREFERENCIAS = 12

const clave = (ambito: string) => `${PREFIJO}${ambito}`

/** Firma estable de un conjunto de filtros; sirve para comparar y deduplicar. */
export function firmaFiltros(filtros: Record<string, string>): string {
  return Object.entries(filtros)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => [k, k === 'etq' ? v.split(',').filter(Boolean).sort().join(',') : v] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/** Deja sólo pares con valor, para no guardar filtros vacíos. */
export function limpiarFiltros(filtros: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(filtros)) if (v) out[k] = v
  return out
}

/** Valida la forma de lo leído del storage; descarta entradas corruptas. */
function normalizar(crudo: unknown): PreferenciaFiltro[] {
  if (!Array.isArray(crudo)) return []
  const out: PreferenciaFiltro[] = []
  for (const p of crudo) {
    if (!p || typeof p !== 'object') continue
    const { id, nombre, filtros } = p as Partial<PreferenciaFiltro>
    if (typeof id !== 'string' || typeof nombre !== 'string' || !nombre.trim()) continue
    if (!filtros || typeof filtros !== 'object' || Array.isArray(filtros)) continue
    const pares: Record<string, string> = {}
    for (const [k, v] of Object.entries(filtros)) if (typeof v === 'string' && v) pares[k] = v
    if (Object.keys(pares).length === 0) continue
    out.push({ id, nombre: nombre.trim(), filtros: pares })
  }
  return out.slice(0, MAX_PREFERENCIAS)
}

export function leerPreferencias(ambito: string): PreferenciaFiltro[] {
  try {
    const crudo = window.localStorage.getItem(clave(ambito))
    return crudo ? normalizar(JSON.parse(crudo)) : []
  } catch {
    return [] /* modo privado o JSON dañado */
  }
}

function escribir(ambito: string, lista: PreferenciaFiltro[]): PreferenciaFiltro[] {
  try {
    window.localStorage.setItem(clave(ambito), JSON.stringify(lista))
  } catch {
    /* modo privado */
  }
  return lista
}

/**
 * Agrega la preferencia. Si ya existe una con el mismo nombre (sin distinguir
 * mayúsculas) la reemplaza, para que "guardar" sobre una vista conocida la
 * actualice en vez de duplicarla.
 */
export function agregarPreferencia(
  lista: PreferenciaFiltro[],
  nombre: string,
  filtros: Record<string, string>,
  id: string
): PreferenciaFiltro[] {
  const limpio = nombre.trim()
  const pares = limpiarFiltros(filtros)
  if (!limpio || Object.keys(pares).length === 0) return lista
  const nueva: PreferenciaFiltro = { id, nombre: limpio, filtros: pares }
  const idx = lista.findIndex((p) => p.nombre.toLowerCase() === limpio.toLowerCase())
  if (idx >= 0) return lista.map((p, i) => (i === idx ? nueva : p))
  return [...lista, nueva].slice(-MAX_PREFERENCIAS)
}

export function guardarPreferencia(
  ambito: string,
  nombre: string,
  filtros: Record<string, string>,
  id: string
): PreferenciaFiltro[] {
  return escribir(ambito, agregarPreferencia(leerPreferencias(ambito), nombre, filtros, id))
}

export function borrarPreferencia(ambito: string, id: string): PreferenciaFiltro[] {
  return escribir(ambito, leerPreferencias(ambito).filter((p) => p.id !== id))
}
