/**
 * Mensaje legible de un error lanzado por una acción de servidor.
 *
 * En producción Next.js reemplaza el mensaje de los errores que lanza una acción
 * por un texto genérico en inglés ("An error occurred in the Server Components
 * render…"). En ese caso se muestra `respaldo`, en español. En desarrollo llega
 * el mensaje real y se muestra tal cual.
 */
export function mensajeDeError(e: unknown, respaldo: string): string {
  const msg = e instanceof Error ? e.message.trim() : typeof e === 'string' ? e.trim() : ''
  if (!msg || /Server Components render|omitted in production/i.test(msg)) return respaldo
  return msg
}

/**
 * Postgres rechaza un texto más largo que su columna con
 * "value too long for type character varying(20)", sin decir cuál campo. Esto
 * lo pasa a español con el tope, para que la persona sepa qué recortar.
 * Devuelve null si el mensaje no es de ese tipo.
 */
export function textoDemasiadoLargo(msg: string): string | null {
  const m = msg.match(/value too long for type character(?: varying)?\((\d+)\)/i)
  if (!m) return null
  return `Uno de los campos tiene más de ${m[1]} caracteres, que es lo máximo que admite. Acórtalo e intenta de nuevo.`
}
