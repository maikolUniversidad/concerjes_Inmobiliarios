import 'server-only'

// Datos de la petición que los route handlers de campo guardan como auditoría.
// Son dato, no credencial: sirven para reconocer un patrón de sondeo (alguien
// probando PIN desde la misma IP), no para autorizar nada.

import type { NextRequest } from 'next/server'

/** IP del solicitante tal como la reporta el proxy. `INET` rechaza cualquier
 *  cosa que no sea una dirección, así que lo que no lo parezca se descarta en
 *  vez de hacer fallar el INSERT de auditoría. */
export function ipDeSolicitud(req: NextRequest): string | null {
  const directa = req.headers.get('x-real-ip')
  if (directa && /^[0-9a-fA-F.:]+$/.test(directa.trim())) return directa.trim()
  const primera = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!primera) return null
  return /^[0-9a-fA-F.:]+$/.test(primera) ? primera : null
}

/** User agent recortado: no hace falta guardar 2 KB de cadena. */
export function agenteDeSolicitud(req: NextRequest): string | null {
  const ua = req.headers.get('user-agent')
  return ua ? ua.slice(0, 300) : null
}
