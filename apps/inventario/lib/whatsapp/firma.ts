// Verificación de la firma de Meta. Es el ÚNICO control de autenticidad del
// webhook: no hay cookie, no hay token de sesión, no hay IP de confianza. Un
// bug aquí es un bot que cualquiera puede manejar.
//
// Las tres reglas que importan:
//   1. SOBRE EL CUERPO CRUDO, byte a byte. En App Router: `await req.text()` y
//      recién después `JSON.parse`. Nunca re-serializar: cualquier diferencia
//      de escapes (`\/` frente a `/`) o de orden de llaves cambia el hash.
//   2. Comparación en TIEMPO CONSTANTE, con las longitudes ya igualadas.
//   3. Sin header, con firma mala o sin app secret configurado → 403, se
//      registra el rechazo y NO se encola nada.

import { createHmac, timingSafeEqual } from 'node:crypto'

export type MotivoRechazo =
  | 'SIN_FIRMA'
  | 'FIRMA_INVALIDA'
  | 'SIN_SECRETO'
  | 'CUERPO_INVALIDO'
  | 'VERIFY_TOKEN'
  | 'CUERPO_GRANDE'

export interface Veredicto {
  ok: boolean
  motivo?: MotivoRechazo
}

/** El cuerpo del webhook puede pesar hasta 3 MB; el tope de cuerpo de una
 *  función de Vercel es 4,5 MB. Se corta antes para no gastar CPU firmando algo
 *  que de todos modos no puede ser de Meta. */
export const TOPE_CUERPO_BYTES = 3 * 1024 * 1024

/** Firma un cuerpo como lo firmaría Meta. La usa el SIMULADOR para inyectar
 *  mensajes por el camino completo —firma incluida— en vez de una ruta
 *  paralela que no probaría nada. */
export function firmar(cuerpo: string, secreto: string): string {
  return 'sha256=' + createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')
}

/**
 * ¿La firma del header corresponde a este cuerpo?
 *
 * `cuerpo` tiene que ser el texto EXACTO que llegó. `header` es el valor de
 * `X-Hub-Signature-256`, con su prefijo `sha256=`.
 */
export function verificarFirma(
  cuerpo: string,
  header: string | null | undefined,
  secreto: string | null | undefined,
): Veredicto {
  // Sin secreto no se puede verificar NADA, y sin verificar no se procesa. Un
  // despliegue al que le falta la variable no es un despliegue permisivo.
  if (!secreto) return { ok: false, motivo: 'SIN_SECRETO' }
  if (!header) return { ok: false, motivo: 'SIN_FIRMA' }

  const crudo = header.trim()
  if (!crudo.startsWith('sha256=')) return { ok: false, motivo: 'SIN_FIRMA' }
  const recibida = crudo.slice('sha256='.length).toLowerCase()
  // 64 hexadecimales, ni uno más ni uno menos. Se comprueba antes de
  // `timingSafeEqual`, que lanza si los búferes no miden igual.
  if (!/^[0-9a-f]{64}$/.test(recibida)) return { ok: false, motivo: 'FIRMA_INVALIDA' }

  const esperada = createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')
  const a = Buffer.from(recibida, 'hex')
  const b = Buffer.from(esperada, 'hex')
  if (a.length !== b.length) return { ok: false, motivo: 'FIRMA_INVALIDA' }
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, motivo: 'FIRMA_INVALIDA' }
}

/**
 * Reto de suscripción (`GET`). Meta lo manda cada vez que se fija o se edita la
 * Callback URL o el Verify token, y NO entrega ningún webhook hasta recibir un
 * 200 con el `hub.challenge` crudo. Si esto falla, el síntoma es «no llegan
 * mensajes» y no hay ningún error visible en ninguna parte.
 */
export function resolverReto(
  params: URLSearchParams,
  verifyToken: string | null | undefined,
): { ok: true; challenge: string } | { ok: false; motivo: MotivoRechazo } {
  if (!verifyToken) return { ok: false, motivo: 'SIN_SECRETO' }
  const modo = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (modo !== 'subscribe') return { ok: false, motivo: 'VERIFY_TOKEN' }
  if (typeof token !== 'string' || typeof challenge !== 'string') {
    return { ok: false, motivo: 'VERIFY_TOKEN' }
  }
  // Tiempo constante también aquí: el verify token es un secreto.
  const a = Buffer.from(token, 'utf8')
  const b = Buffer.from(verifyToken, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'VERIFY_TOKEN' }
  }
  return { ok: true, challenge }
}
