// Forma del token del QR, código manual, formatos de impresión y etiquetas de
// la consola (F2 del módulo de Puntos QR). Es el espejo en TypeScript de la
// migración 20261019000020_puntos_qr_f2_puntos.sql.
//
// Este archivo es PURO: no importa nada, ni del proyecto ni de Node, así que lo
// pueden usar por igual un componente de cliente, una server action y el script
// de pruebas. **La firma HMAC vive aparte**, en `lib/puntos-qr-firma.ts`, que sí
// importa `node:crypto` y nunca debe llegar al navegador: la llave es un
// secreto del servidor.
//
// Formato del token, 21 caracteres:
//
//   <v><clave_publica><version><firma>
//    1       8            2       10      = 21
//   "1"  "K7M4QX9T"      "01"  "A9F3C1B7E2"
//
// y la firma son los primeros 10 caracteres de base32 sin ambigüedades de
//   HMAC-SHA256(llave_cliente_vN, "<v>|<punto_id>|<version>")
//
// Lo que viaja impreso en la placa es `https://<host>/q/<token>` — con `/q/`,
// que es lo que manda docs/puntos-qr-whatsapp/03-nomenclatura.md §3. Donde los
// documentos 00 y 02 digan `/p/`, hay que leer `/q/`.

/** Base32 sin ambigüedades (Crockford): sin I, L, O ni U. 32 símbolos exactos,
 *  5 bits por carácter. El 0 y el 1 sí entran: esto lo lee una cámara. */
export const ALFABETO_TOKEN = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Alfabeto del código manual: además de I, L, O y U salen el 0 y el 1, porque
 *  esto lo TECLEA una persona mirando una placa (ADR-B). */
export const ALFABETO_MANUAL = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export const VERSION_TOKEN = '1'
export const LARGO_CLAVE_PUNTO = 8
export const LARGO_FIRMA = 10
export const LARGO_MANUAL = 8
export const LARGO_TOKEN = 1 + LARGO_CLAVE_PUNTO + 2 + LARGO_FIRMA   // 21

export function esDeAlfabeto(s: string, alfabeto: string): boolean {
  for (const c of s) if (!alfabeto.includes(c)) return false
  return true
}

export interface TokenPartido {
  versionFormato: string
  clavePublica: string
  version: number
  firma: string
}

/** Parte un token sin verificar la firma. Devuelve null si no tiene la forma. */
export function partirToken(token: string): TokenPartido | null {
  const t = (token ?? '').trim().toUpperCase()
  if (t.length !== LARGO_TOKEN || !esDeAlfabeto(t, ALFABETO_TOKEN)) return null
  if (t[0] !== VERSION_TOKEN) return null
  const ver = Number(t.slice(1 + LARGO_CLAVE_PUNTO, 1 + LARGO_CLAVE_PUNTO + 2))
  if (!Number.isInteger(ver) || ver < 1) return null
  return {
    versionFormato: t[0],
    clavePublica: t.slice(1, 1 + LARGO_CLAVE_PUNTO),
    version: ver,
    firma: t.slice(1 + LARGO_CLAVE_PUNTO + 2),
  }
}

/** Lo que el usuario teclea o escanea, normalizado: mayúsculas y sin guiones ni
 *  espacios. No "arregla" letras parecidas a propósito: si alguien escribe una
 *  O donde va un 0, el código es otro y tiene que fallar, no abrir otro punto. */
export function normalizar(entrada: string): string {
  return (entrada ?? '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export const esToken = (s: string) => partirToken(s) !== null
export const esCodigoManual = (s: string) =>
  s.length === LARGO_MANUAL && esDeAlfabeto(s, ALFABETO_MANUAL)

/** `K7M4QX9T` → `K7M4-QX9T`: así se imprime bajo el QR y así se lee en voz
 *  alta. En grupos de CUATRO, no de 3+4 como aparece en el ADR-B (`K7M-4QX9`):
 *  ese ejemplo del documento se come un carácter de los ocho, y un código
 *  impreso al que le falta una letra no abre nada. */
export function formatearManual(codigo: string): string {
  const c = normalizar(codigo)
  return c.length === LARGO_MANUAL ? `${c.slice(0, 4)}-${c.slice(4)}` : c
}

/** URL absoluta que va dentro del QR. */
export function urlDelQr(token: string, base: string): string {
  return `${base.replace(/\/+$/, '')}/q/${token}`
}

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
