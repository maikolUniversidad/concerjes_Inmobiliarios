// Firma de documentos uno tras otro («Firmar y seguir») en Mi proceso.

export type EstadoFirma = 'pendiente' | 'firmado' | 'omitido'

/**
 * El siguiente documento por firmar después de `desde`. Si se empezó por la
 * mitad de la lista, al llegar al final da la vuelta y sigue con los de arriba.
 * Los omitidos no vuelven a salir solos (se ofrecen al terminar). -1 si ya no
 * queda ninguno. Con `desde = -1` busca desde el primero.
 */
export function siguientePendiente(estados: readonly EstadoFirma[], desde: number): number {
  const n = estados.length
  for (let paso = 1; paso <= n; paso++) {
    const j = (Math.max(-1, desde) + paso) % n
    if (estados[j] === 'pendiente') return j
  }
  return -1
}

export interface ResumenFirma { firmados: number; omitidos: number; pendientes: number; total: number }

export function resumenFirma(estados: readonly EstadoFirma[]): ResumenFirma {
  const cuenta = (e: EstadoFirma) => estados.filter((x) => x === e).length
  return { firmados: cuenta('firmado'), omitidos: cuenta('omitido'), pendientes: cuenta('pendiente'), total: estados.length }
}

/** Vuelve a poner por firmar los omitidos (botón «Firmar los que dejé para después»). */
export function retomarOmitidos(estados: readonly EstadoFirma[]): EstadoFirma[] {
  return estados.map((e) => (e === 'omitido' ? 'pendiente' : e))
}
