// Lo del QR que es de la CONSOLA: formatos de impresión, estados, etiquetas y
// textos. La forma del token y del código manual se movió a
// `packages/ronda-core/src/codigo.ts` en F4, porque la PWA del trabajador y el
// módulo de `apps/movil` tienen que leer un código IGUAL que la consola
// (decisión §1.1 del complemento 2). Aquí se reexporta tal cual, así que todo
// lo que ya importaba de `@/lib/puntos-qr` sigue funcionando.
//
// **La firma HMAC vive aparte**, en `lib/puntos-qr-firma.ts`, que importa
// `node:crypto` y nunca debe llegar al navegador: la llave es un secreto del
// servidor.
//
// Lo que viaja impreso en la placa es `https://<host>/q/<token>` — con `/q/`,
// que es lo que manda docs/puntos-qr-whatsapp/03-nomenclatura.md §3. Donde los
// documentos 00 y 02 digan `/p/`, hay que leer `/q/`.
//
// La importación es RELATIVA y no por el alias del paquete a propósito: los
// scripts de prueba (scripts/probar-puntos-qr-f2.mjs y probar-placas-qr-f2.mjs)
// importan este archivo por ruta y resuelven relativo, no el alias.
export * from '../../../packages/ronda-core/src/codigo'

// ──────────────────────────────────────────────────────────────────────────────
// Formatos de impresión
// ──────────────────────────────────────────────────────────────────────────────
// El QR se imprime a 50 mm de lado como MÍNIMO en todos los formatos: es la
// medida con la que el ADR-B lo da por legible, y bajarla para ganar espacio de
// texto es lo único de esta pantalla que obliga a reimprimir placas.

export type FormatoLote = 'STICKER_8X8' | 'PLACA_A6' | 'PLACA_A5' | 'HOJA_A4'

export interface MedidasFormato {
  label: string
  /** Hoja, en milímetros. */
  ancho: number
  alto: number
  /** Cuántas placas caben en la hoja. */
  columnas: number
  filas: number
  /** Lado del QR, en milímetros. Nunca menos de 50. */
  qr: number
  detalle: string
}

export const FORMATOS: Record<FormatoLote, MedidasFormato> = {
  STICKER_8X8: {
    label: 'Sticker 8 × 8 cm',
    ancho: 80, alto: 80, columnas: 1, filas: 1, qr: 50,
    detalle: 'Adhesivo cuadrado, uno por página. Para superficies lisas.',
  },
  PLACA_A6: {
    label: 'Placa A6 (10,5 × 14,8 cm)',
    ancho: 105, alto: 148, columnas: 1, filas: 1, qr: 62,
    detalle: 'Placa con el nombre del punto y la sede. La medida habitual en pared.',
  },
  PLACA_A5: {
    label: 'Placa A5 (14,8 × 21 cm)',
    ancho: 148, alto: 210, columnas: 1, filas: 1, qr: 90,
    detalle: 'Placa grande, para parqueaderos y zonas comunes amplias.',
  },
  HOJA_A4: {
    label: 'Hoja A4 con 6 placas',
    ancho: 210, alto: 297, columnas: 2, filas: 3, qr: 50,
    detalle: 'Seis placas por hoja para imprimir el lote de una sede y recortar.',
  },
}

export const FORMATOS_LOTE = Object.keys(FORMATOS) as FormatoLote[]

/** Cuántas placas caben en una hoja del formato. */
export const porHoja = (f: FormatoLote) => FORMATOS[f].columnas * FORMATOS[f].filas

// ──────────────────────────────────────────────────────────────────────────────
// Estados y etiquetas de la consola
// ──────────────────────────────────────────────────────────────────────────────

export type EstadoPunto = 'BORRADOR' | 'ACTIVO' | 'SUSPENDIDO' | 'RETIRADO'
export type EstadoQr = 'BORRADOR' | 'ACTIVO' | 'REVOCADO' | 'REEMPLAZADO'

export const ESTADO_PUNTO: Record<EstadoPunto, { label: string; badge: string }> = {
  BORRADOR:   { label: 'Borrador',   badge: 'bg-gray-100 text-gray-600' },
  ACTIVO:     { label: 'Activo',     badge: 'bg-emerald-100 text-emerald-700' },
  SUSPENDIDO: { label: 'Suspendido', badge: 'bg-amber-100 text-amber-700' },
  RETIRADO:   { label: 'Retirado',   badge: 'bg-gray-200 text-gray-700' },
}
export const ESTADOS_PUNTO = Object.keys(ESTADO_PUNTO) as EstadoPunto[]

export const ESTADO_QR: Record<EstadoQr, { label: string; badge: string }> = {
  BORRADOR:    { label: 'Borrador',    badge: 'bg-gray-100 text-gray-600' },
  ACTIVO:      { label: 'Activo',      badge: 'bg-emerald-100 text-emerald-700' },
  REVOCADO:    { label: 'Revocado',    badge: 'bg-red-100 text-red-700' },
  REEMPLAZADO: { label: 'Reemplazado', badge: 'bg-gray-200 text-gray-700' },
}

export const DIAS_SEMANA = [
  { n: 1, corto: 'Lu', label: 'Lunes' },
  { n: 2, corto: 'Ma', label: 'Martes' },
  { n: 3, corto: 'Mi', label: 'Miércoles' },
  { n: 4, corto: 'Ju', label: 'Jueves' },
  { n: 5, corto: 'Vi', label: 'Viernes' },
  { n: 6, corto: 'Sá', label: 'Sábado' },
  { n: 7, corto: 'Do', label: 'Domingo' },
]

/** "Lu Ma Mi Ju Vi · 06:00–18:00" o "Todos los días" para el listado. */
export function textoHorario(
  dias: number[] | null, desde: string | null, hasta: string | null,
): string {
  const d = (dias ?? []).slice().sort((a, b) => a - b)
  const nombres = d.length === 7
    ? 'Todos los días'
    : d.map((n) => DIAS_SEMANA.find((x) => x.n === n)?.corto ?? String(n)).join(' ')
  if (!desde && !hasta) return nombres
  const hm = (t: string | null) => (t ? t.slice(0, 5) : '')
  return `${nombres} · ${hm(desde) || '00:00'}–${hm(hasta) || '24:00'}`
}

/** Cómo se rotula la precisión con la que se capturó el punto. Una precisión
 *  peor que el radio de la geocerca hace que la geocerca no signifique nada, y
 *  eso la pantalla lo tiene que decir, no esconder. */
export function calidadGps(
  precision: number | null | undefined, geocerca: number,
): { texto: string; alerta: boolean } {
  if (precision === null || precision === undefined) {
    return { texto: 'Sin precisión registrada', alerta: true }
  }
  const p = Math.round(precision)
  if (precision > geocerca) {
    return { texto: `±${p} m — peor que la geocerca de ${geocerca} m`, alerta: true }
  }
  return { texto: `±${p} m`, alerta: false }
}
