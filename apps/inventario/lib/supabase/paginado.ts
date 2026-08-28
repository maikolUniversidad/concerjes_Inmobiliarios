/**
 * Paginación para consultas de Supabase.
 *
 * PostgREST corta TODA respuesta en 1.000 filas (`db-max-rows`). El tope es del
 * servidor, así que `.limit(5000)` NO lo levanta: devuelve 1.000 filas sin error
 * y sin aviso, y el código de arriba cree que esos son todos los datos. La única
 * forma de traer un conjunto completo es pedirlo por páginas con `.range()`.
 *
 * Uso:
 *
 *   const productos = await traerTodo((desde, hasta) =>
 *     supabase.from('productos').select('id, nombre').eq('activo', true).range(desde, hasta)
 *   )
 *
 * Ojo: pagina con OFFSET, así que la consulta debe traer un `.order()` estable
 * (por clave única o por una columna + id). Sin orden, PostgreSQL no garantiza
 * el mismo orden entre páginas y se pueden repetir o perder filas.
 */

export const PAGINA_POSTGREST = 1000

/** Techo de seguridad: evita bucles infinitos si una consulta nunca se agota. */
const MAX_FILAS_POR_DEFECTO = 100_000

export interface RespuestaPagina<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface OpcionesPaginado {
  /** Filas por página. Nunca conviene subirlo de 1.000: el servidor lo corta ahí. */
  pagina?: number
  /** Tope duro de filas a acumular. */
  maximo?: number
  /**
   * Nombre para el mensaje de error. Si se omite y la consulta falla, se lanza
   * el error crudo de PostgREST.
   */
  etiqueta?: string
}

/**
 * Ejecuta `hacerPagina` tantas veces como haga falta y devuelve TODAS las filas.
 * Lanza si alguna página falla (nunca devuelve datos a medias en silencio).
 */
export async function traerTodo<T>(
  hacerPagina: (desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  { pagina = PAGINA_POSTGREST, maximo = MAX_FILAS_POR_DEFECTO, etiqueta }: OpcionesPaginado = {},
): Promise<T[]> {
  const acc: T[] = []
  for (let desde = 0; desde < maximo; desde += pagina) {
    const { data, error } = await hacerPagina(desde, desde + pagina - 1)
    if (error) {
      throw new Error(etiqueta ? `${etiqueta}: ${error.message}` : error.message)
    }
    const lote = data ?? []
    acc.push(...lote)
    if (lote.length < pagina) return acc
  }
  return acc
}

/**
 * Igual que `traerTodo`, pero para consultas con `.in(columna, ids)`: parte los
 * ids en lotes (la URL de PostgREST tiene un largo máximo) y pagina cada lote.
 */
export async function traerTodoPorIds<T>(
  ids: readonly string[],
  hacerPagina: (lote: string[], desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  { tamanoLote = 60, ...opciones }: OpcionesPaginado & { tamanoLote?: number } = {},
): Promise<T[]> {
  const acc: T[] = []
  for (let i = 0; i < ids.length; i += tamanoLote) {
    const lote = ids.slice(i, i + tamanoLote)
    acc.push(...(await traerTodo<T>((desde, hasta) => hacerPagina(lote, desde, hasta), opciones)))
  }
  return acc
}

/**
 * Inserta muchas filas en lotes y devuelve las filas que PostgREST regresó.
 *
 * Dos motivos para lotear, no uno:
 *  1. El `.select()` que acompaña al insert es una respuesta como cualquier
 *     otra, así que también se corta en 1.000 filas. La escritura sí se hace
 *     completa (`db-max-rows` limita lo que se DEVUELVE, no lo que se graba),
 *     pero el código que use ese resultado —para refrescar una lista o para
 *     decir "se copiaron N"— se queda corto y muestra menos de lo que hay.
 *  2. Un insert de miles de filas es un cuerpo de petición enorme; en lotes
 *     tiene mucha menos probabilidad de chocar con límites de tamaño.
 *
 * NO es atómico: cada lote es su propia transacción. Por eso devuelve
 * `insertadas` junto con `error`, para que quien llama pueda informar con
 * honestidad cuántas filas alcanzaron a quedar cuando algo falla a mitad.
 */
export async function insertarPorLotes<F, T>(
  filas: readonly F[],
  hacerLote: (lote: F[]) => PromiseLike<RespuestaPagina<T>>,
  { tamanoLote = 500 }: { tamanoLote?: number } = {},
): Promise<{ devueltas: T[]; insertadas: number; error: string | null }> {
  const devueltas: T[] = []
  let insertadas = 0
  for (let i = 0; i < filas.length; i += tamanoLote) {
    const lote = filas.slice(i, i + tamanoLote)
    const { data, error } = await hacerLote(lote)
    if (error) return { devueltas, insertadas, error: error.message }
    insertadas += lote.length
    devueltas.push(...(data ?? []))
  }
  return { devueltas, insertadas, error: null }
}
