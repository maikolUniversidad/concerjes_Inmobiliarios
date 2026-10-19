/**
 * Errores de las acciones de servidor que SÍ llegan a la pantalla.
 *
 * Una acción de servidor que lanza (`throw`) un error no sirve en producción:
 * Next.js reemplaza el mensaje por un texto genérico en inglés y, si nadie lo
 * atrapa, la página entera cae en "This page couldn't load". Por eso:
 *
 *   - En el servidor, la acción envuelve su cuerpo con `capturar()`: nunca
 *     lanza, devuelve `{ ok: false, error }` con el mensaje real.
 *   - En el cliente, la pantalla envuelve la acción con `conError()`: si vuelve
 *     un error, lo lanza AHÍ (en el navegador, sin censura), así el try/catch
 *     que ya tenga la pantalla muestra el motivo de verdad.
 *
 * Este archivo no es 'use server' a propósito: un archivo de acciones solo puede
 * exportar funciones async, y estas utilidades se importan desde ambos lados.
 */

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

/** Las navegaciones de Next (redirect, notFound) viajan como errores: no se tocan. */
function esNavegacionNext(e: unknown): boolean {
  const digest = e && typeof e === 'object' && 'digest' in e ? String((e as { digest?: unknown }).digest) : ''
  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') || digest === 'NEXT_NOT_FOUND'
}

/** Mensaje de cualquier cosa lanzada: Error, error de Supabase ({ message }) o texto. */
function mensajeDe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (e && typeof e === 'object' && 'message' in e && (e as { message?: unknown }).message) {
    return String((e as { message: unknown }).message)
  }
  if (typeof e === 'string' && e) return e
  return 'Ocurrió un error inesperado. Intenta de nuevo.'
}

/** Servidor: ejecuta el cuerpo de la acción y convierte cualquier error en `{ ok: false }`. */
export async function capturar<T>(cuerpo: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, data: await cuerpo() }
  } catch (e) {
    if (esNavegacionNext(e)) throw e
    console.error('[accion]', e)
    return { ok: false, error: mensajeDe(e) }
  }
}

/** Cliente: devuelve el dato o lanza el error real (ya en el navegador). */
export function desenvolver<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

/** Cliente: la misma acción, pero que lanza el error real en vez de devolverlo. */
export function conError<A extends unknown[], T>(accion: (...args: A) => Promise<Resultado<T>>) {
  return async (...args: A): Promise<T> => desenvolver(await accion(...args))
}
