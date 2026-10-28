import 'server-only'

// Cifrado de los tokens de Meta antes de guardarlos.
//
// POR QUÉ: `whatsapp_credenciales` vive en la misma base que todo lo demás, y un
// token de WhatsApp Business deja mandar mensajes a nombre de la empresa a
// cualquier número. Un respaldo de la base que se filtre no puede llevar
// tokens usables. La llave vive en el entorno (`WHATSAPP_TOKEN_LLAVE`), nunca
// en la base: quien lea la tabla sin la llave no tiene nada.
//
// AES-256-GCM, que además autentica: si alguien edita el ciphertext a mano, el
// descifrado falla en vez de devolver basura.
//
// El token se trata como CADENA OPACA de longitud variable: no se valida su
// forma, no se recorta y no se registra en ningún log. Lo pide la propia
// documentación de Meta y es lo sensato.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const IV_BYTES = 12
const ETIQUETA_BYTES = 16

function llave(): Buffer {
  const cruda = process.env.WHATSAPP_TOKEN_LLAVE
  if (!cruda || cruda.length < 32) {
    throw new Error(
      'Falta WHATSAPP_TOKEN_LLAVE (mínimo 32 caracteres). Sin ella no se pueden guardar ' +
        'ni leer los tokens de WhatsApp, y guardarlos en claro no es una opción.',
    )
  }
  // La llave de entorno es texto; AES-256 necesita 32 bytes exactos.
  return createHash('sha256').update(cruda, 'utf8').digest()
}

export function hayLlave(): boolean {
  const c = process.env.WHATSAPP_TOKEN_LLAVE
  return !!c && c.length >= 32
}

/** Cifra un token. El resultado es `base64(iv):base64(etiqueta):base64(datos)`. */
export function cifrar(claro: string): string {
  if (!claro) throw new Error('No hay nada que cifrar.')
  const iv = randomBytes(IV_BYTES)
  const c = createCipheriv(ALG, llave(), iv)
  const datos = Buffer.concat([c.update(claro, 'utf8'), c.final()])
  const etiqueta = c.getAuthTag()
  return [iv.toString('base64'), etiqueta.toString('base64'), datos.toString('base64')].join(':')
}

/** Descifra un token. Lanza si el ciphertext fue alterado o la llave no es la
 *  misma con la que se cifró. */
export function descifrar(guardado: string): string {
  const partes = (guardado ?? '').split(':')
  if (partes.length !== 3) throw new Error('El token guardado no tiene la forma esperada.')
  const iv = Buffer.from(partes[0], 'base64')
  const etiqueta = Buffer.from(partes[1], 'base64')
  const datos = Buffer.from(partes[2], 'base64')
  if (iv.length !== IV_BYTES || etiqueta.length !== ETIQUETA_BYTES) {
    throw new Error('El token guardado no tiene la forma esperada.')
  }
  const d = createDecipheriv(ALG, llave(), iv)
  d.setAuthTag(etiqueta)
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8')
}
