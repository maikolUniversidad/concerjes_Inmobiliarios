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
