// Forma del token del QR y del código manual. Es la pieza del ADR-B que NO es
// secreta: la firma HMAC se verifica en el servidor, que es el único que tiene
// la llave (apps/inventario/lib/puntos-qr-firma.ts); esto es lo que cualquiera
// de las dos apps necesita para saber si lo que escaneó o tecleó tiene forma de
// código antes de preguntarle al servidor.
//
// Vive aquí y no en la app por la decisión §1.1 del complemento 2: lo que las
// dos apps tienen que hacer igual no puede vivir en una de las dos.
// `apps/inventario/lib/puntos-qr.ts` lo reexporta y le suma lo que es de la
// consola (formatos de impresión, etiquetas, badges).
//
// Formato del token, 21 caracteres:
//
//   <v><clave_publica><version><firma>
//    1       8            2       10      = 21
//   "1"  "K7M4QX9T"      "01"  "A9F3C1B7E2"

/** Base32 sin ambigüedades (Crockford): sin I, L, O ni U. El 0 y el 1 sí
 *  entran, porque esto lo lee una cámara. */
export const ALFABETO_TOKEN = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Alfabeto del código manual: además de I, L, O y U salen el 0 y el 1, porque
 *  esto lo TECLEA una persona mirando una placa de noche. */
export const ALFABETO_MANUAL = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export const VERSION_TOKEN = '1'
export const LARGO_CLAVE_PUNTO = 8
export const LARGO_FIRMA = 10
export const LARGO_MANUAL = 8
export const LARGO_TOKEN = 1 + LARGO_CLAVE_PUNTO + 2 + LARGO_FIRMA // 21

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

/** Lo que se teclea o escanea, normalizado: mayúsculas y sin guiones ni
 *  espacios. No "arregla" letras parecidas a propósito: si alguien escribe una
 *  O donde va un 0, el código es otro y tiene que fallar, no abrir el punto de
 *  al lado. */
export function normalizar(entrada: string): string {
  return (entrada ?? '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export const esToken = (s: string) => partirToken(s) !== null
export const esCodigoManual = (s: string) =>
  s.length === LARGO_MANUAL && esDeAlfabeto(s, ALFABETO_MANUAL)

/** `K7M4QX9T` → `K7M4-QX9T`: así se imprime bajo el QR y así se lee en voz alta. */
export function formatearManual(codigo: string): string {
  const c = normalizar(codigo)
  return c.length === LARGO_MANUAL ? `${c.slice(0, 4)}-${c.slice(4)}` : c
}

/** URL absoluta que va dentro del QR. */
export function urlDelQr(token: string, base: string): string {
  return `${base.replace(/\/+$/, '')}/q/${token}`
}

export type AperturaModo = 'QR' | 'MANUAL' | 'ASISTIDA'

/**
 * Qué se escribió en la caja de "escanear o escribir el código": un token de
 * placa, un código manual, o nada reconocible. Es lo que decide si la apertura
 * de la visita se marca `QR` o `MANUAL`, que pesan distinto en el puntaje de
 * F13 (el manual no lleva firma y vale menos).
 */
export function clasificarEntrada(
  entrada: string,
): { tipo: 'TOKEN' | 'MANUAL' | 'DESCONOCIDO'; codigo: string; modo: AperturaModo | null } {
  const c = normalizar(entrada)
  if (esToken(c)) return { tipo: 'TOKEN', codigo: c, modo: 'QR' }
  if (esCodigoManual(c)) return { tipo: 'MANUAL', codigo: c, modo: 'MANUAL' }
  return { tipo: 'DESCONOCIDO', codigo: c, modo: null }
}

/** Saca el código de lo que devuelve un lector de QR, que puede traer la URL
 *  completa (`https://app/q/1K7M…`) o solo el token. */
export function codigoDeEscaneo(leido: string): string {
  const s = (leido ?? '').trim()
  const m = s.match(/\/q\/([^/?#\s]+)/i)
  return normalizar(m ? m[1] : s)
}
