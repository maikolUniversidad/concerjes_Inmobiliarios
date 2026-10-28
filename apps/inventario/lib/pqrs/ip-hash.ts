// El `ip_hash` de una PQRS radicada por el QR. **SOLO SERVIDOR** (usa
// node:crypto). No lleva `import 'server-only'` a propósito: lo importa tal
// cual `scripts/probar-puntos-qr-f5.mjs` para comprobar que el hash que calcula
// la aplicación es exactamente el que termina en la base.
//
// Se guarda el HASH y NUNCA la IP, que es dato personal (Ley 1581 de 2012):
// alcanza para contar cuántas veces vino el mismo origen en la última hora y no
// deja direcciones en claro. Mismo criterio de
// `20260906000000_empresas_cotizacion_rate_limit.sql`.

import { createHash } from 'node:crypto'

/**
 * SHA-256 de la IP con una sal. Se guarda esto y NUNCA la IP, que es dato
 * personal (Ley 1581 de 2012): alcanza para contar cuántas veces vino el mismo
 * origen en la última hora, y no deja direcciones en claro en la base. Mismo
 * criterio de `20260906000000_empresas_cotizacion_rate_limit.sql`.
 */
export function hashDeIp(ip: string, sal: string): string {
  return createHash('sha256').update(`${sal}|${ip.trim().toLowerCase()}`).digest('hex')
}

/**
 * La sal del despliegue. `PQRS_IP_SALT` si está; si no, la llave con la que se
 * firman los QR, que ya es un secreto del servidor y existe en el mismo
 * despliegue (lib/puntos-qr-firma.ts).
 *
 * Si no hay ninguna, devuelve null y la radicación sigue: se guarda `ip_hash`
 * NULL y el límite que protege es el del PUNTO. Lo que NO se hace nunca es
 * guardar la IP en claro ni usar una sal fija escrita en el repositorio, que
 * con el espacio de IPv4 sería reversible en un rato.
 */
export function salDeIp(): string | null {
  const propia = process.env.PQRS_IP_SALT?.trim()
  if (propia) return propia
  const llave = process.env.RONDA_HMAC_LLAVE_ACTUAL?.trim()
  if (llave) {
    const v = process.env['RONDA_HMAC_' + llave.toUpperCase().replace(/[^A-Z0-9]+/g, '_')]?.trim()
    if (v) return v
  }
  return null
}

/** El `ip_hash` de esta solicitud, o null si el despliegue no tiene sal. */
export function ipHashDeSolicitud(ip: string | null): string | null {
  if (!ip) return null
  const sal = salDeIp()
  return sal ? hashDeIp(ip, sal) : null
}
