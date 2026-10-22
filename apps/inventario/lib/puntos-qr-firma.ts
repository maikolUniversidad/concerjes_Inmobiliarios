// Firma HMAC-SHA256 del token del QR (ADR-B). **SOLO SERVIDOR.**
//
// La llave NO vive en la base de datos: vive en variables de entorno, una por
// cliente y versionada, y en `ronda_qr.firma_llave_id` solo queda cuál se usó.
// Consecuencias que están en el ADR y conviene tener presentes:
//   · rotar la llave NO invalida lo impreso: un token viejo sigue verificando
//     con la llave con la que se firmó, porque su `firma_llave_id` la nombra;
//   · invalidar de verdad exige revocar el QR y REIMPRIMIR la placa;
//   · la firma impide FABRICAR un QR válido, pero no impide FOTOGRAFIAR uno
//     real: contra eso están la geocerca y el antifraude (ADR-02).
//
// Choque abierto que esta fase no resuelve: el ADR-02 pide Ed25519 en vez de
// HMAC para poder verificar el QR sin conexión sin meter el secreto en el APK.
// Con HMAC, la verificación offline obligaría a repartir el secreto, así que un
// QR inventado solo se detecta al sincronizar. Se decide antes de imprimir.
//
// Variables de entorno (ejemplo en .env.example):
//   RONDA_HMAC_LLAVE_ACTUAL=cli-demo-v1
//   RONDA_HMAC_CLI_DEMO_V1=<64 hex o cualquier secreto largo>

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  ALFABETO_TOKEN, LARGO_CLAVE_PUNTO, LARGO_FIRMA, VERSION_TOKEN,
  esDeAlfabeto, partirToken,
} from './puntos-qr'

/** Qué variable de entorno guarda el secreto de una llave:
 *  `cli-demo-v1` → `RONDA_HMAC_CLI_DEMO_V1`. */
export function variableDeLlave(llaveId: string): string {
  return 'RONDA_HMAC_' + llaveId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

/** Identificador de la llave con la que se firma HOY, o null si no hay ninguna
 *  configurada (sin ella no se puede emitir ningún QR, y la pantalla lo dice en
 *  vez de generar códigos que nadie podría verificar). */
export function llaveActual(): string | null {
  const v = process.env.RONDA_HMAC_LLAVE_ACTUAL?.trim()
  return v ? v : null
}

/** Secreto de una llave, o null si no está configurada. */
export function secretoDeLlave(llaveId: string): string | null {
  const v = process.env[variableDeLlave(llaveId)]?.trim()
  return v ? v : null
}

/** Bytes → base32 sin ambigüedades, tomando `largo` caracteres (5 bits cada
 *  uno) desde los bits más significativos. */
function aBase32(bytes: Uint8Array, largo: number): string {
  let salida = ''
  let acumulado = 0
  let bits = 0
  for (const b of bytes) {
    acumulado = (acumulado << 8) | b
    bits += 8
    while (bits >= 5 && salida.length < largo) {
      bits -= 5
      salida += ALFABETO_TOKEN[(acumulado >> bits) & 31]
    }
    if (salida.length >= largo) break
  }
  return salida
}

/** Los 10 caracteres de firma de un punto y una versión. */
export function firmar(puntoId: string, version: number, secreto: string): string {
  const mensaje = `${VERSION_TOKEN}|${puntoId}|${version}`
  const mac = createHmac('sha256', secreto).update(mensaje, 'utf8').digest()
  return aBase32(mac, LARGO_FIRMA)
}

export interface ArmarToken {
  clavePublica: string
  puntoId: string
  version: number
  llaveId: string
  secreto: string
}

/** Arma el token que va impreso, y devuelve también el identificador de la
 *  llave usada, que es lo que se guarda en `ronda_qr.firma_llave_id`. */
export function armarToken(
  { clavePublica, puntoId, version, llaveId, secreto }: ArmarToken,
): { token: string; firmaLlaveId: string } {
  const clave = clavePublica.trim().toUpperCase()
  if (clave.length !== LARGO_CLAVE_PUNTO || !esDeAlfabeto(clave, ALFABETO_TOKEN)) {
    throw new Error('La clave pública del punto no tiene la forma esperada.')
  }
  if (!Number.isInteger(version) || version < 1 || version > 99) {
    // Dos dígitos: cien versiones de un mismo punto son más placas de las que
    // una pared ve en la vida de un contrato. Si alguna vez hiciera falta más,
    // se sube el formato del token a la versión "2".
    throw new Error('La versión del QR debe estar entre 1 y 99.')
  }
  if (!secreto) throw new Error('No hay llave de firma configurada para este QR.')
  const ver = String(version).padStart(2, '0')
  return {
    token: `${VERSION_TOKEN}${clave}${ver}${firmar(puntoId, version, secreto)}`,
    firmaLlaveId: llaveId,
  }
}

/** ¿La firma del token corresponde a este punto y esta versión con esta llave?
 *  Comparación en tiempo constante. */
export function verificarFirma(
  token: string, puntoId: string, version: number, secreto: string,
): boolean {
  const partes = partirToken(token)
  if (!partes || partes.version !== version || !secreto) return false
  const a = Buffer.from(partes.firma, 'utf8')
  const b = Buffer.from(firmar(puntoId, version, secreto), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
