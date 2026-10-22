import 'server-only'

// La sesión de campo de quien NO tiene cuenta (ADR-A, decisión §1.2).
//
// Son ~6.564 personas y ~859 cuentas: la mayoría de quienes van a usar esto no
// tiene fila en `usuarios`, y crearles una cuenta de Supabase Auth a todas para
// que escaneen una placa sería crear 5.700 credenciales que nadie administra.
//
// Cómo funciona:
//   1. la persona pide un enlace con su documento; `ronda_acceso_solicitar()`
//      genera token + PIN y los manda al `persona_canales` VERIFICADO;
//   2. abre el enlace, teclea el PIN y `ronda_acceso_verificar()` quema el
//      enlace y deja la sesión ACTIVA en `ronda_sesiones`;
//   3. esta función firma una cookie con el id de la sesión. La cookie NO lleva
//      permisos ni el persona_id como dato de confianza: lleva el id de la fila
//      y su firma, y la autoridad sigue siendo la tabla.
//
// Por qué una cookie firmada y no un JWT de Supabase: quien entra así no tiene
// `auth.uid()`, así que la RLS no lo puede filtrar. Sus escrituras entran por
// las RPC llamadas desde los route handlers con la llave de servicio — el mismo
// patrón que ya usa la ruta pública /q/<token> en app/q/puerta-supabase.ts,
// donde la autoridad es la firma del QR y no una cookie.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { getAdmin } from '@/lib/supabase/admin'

export const COOKIE_SESION = 'ronda_campo'

/** Secreto con el que se firma la cookie.
 *
 *  `RONDA_SESION_SECRETO` es la variable propia. Si no está, se DERIVA de la
 *  llave de servicio con una etiqueta, para que el módulo funcione sin pedir
 *  configuración nueva el primer día; derivar no es lo mismo que usar la llave
 *  tal cual, pero conviene poner la variable (va en la §4.1 del documento 00).
 */
function secreto(): string {
  const propio = process.env.RONDA_SESION_SECRETO
  if (propio && propio.length >= 16) return propio
  const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!servicio) throw new Error('Falta RONDA_SESION_SECRETO (o SUPABASE_SERVICE_ROLE_KEY)')
  return createHmac('sha256', servicio).update('ronda:sesion:v1').digest('hex')
}

function firmar(valor: string): string {
  return createHmac('sha256', secreto()).update(valor).digest('base64url')
}

function firmaValida(valor: string, firma: string): boolean {
  const esperada = Buffer.from(firmar(valor))
  const recibida = Buffer.from(firma)
  // Comparación de tiempo constante: comparar con `===` filtra, byte a byte,
  // cuánto de la firma acertó quien está probando.
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
}

export interface SesionCampo {
  sesionId: string
  personaId: string
  personaNombre: string | null
  grupoId: string | null
  puntoId: string | null
  venceAt: string
}

/** Valor de la cookie: `<sesion_id>.<firma>`. Nada más: el resto se lee de la
 *  tabla, que es la que puede decir si la sesión sigue viva. */
export function armarCookie(sesionId: string): string {
  return `${sesionId}.${firmar(sesionId)}`
}

function leerCookie(valor: string | undefined): string | null {
  if (!valor) return null
  const i = valor.lastIndexOf('.')
  if (i <= 0) return null
  const id = valor.slice(0, i)
  const firma = valor.slice(i + 1)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    return firmaValida(id, firma) ? id : null
  } catch {
    return null
  }
}

/**
 * Sesión de campo del navegador, verificada contra la tabla. Devuelve null si
 * no hay cookie, si la firma no cuadra, o si la sesión ya venció o se anuló
 * (que es la razón de ir a la base en vez de confiar en la cookie: cerrar una
 * sesión tiene que surtir efecto de inmediato).
 */
export async function sesionDeCampo(): Promise<SesionCampo | null> {
  const bolsa = await cookies()
  const id = leerCookie(bolsa.get(COOKIE_SESION)?.value)
  if (!id) return null

  const { data, error } = await getAdmin()
    .from('ronda_sesiones')
    .select('id, persona_id, persona_nombre, grupo_id, punto_id, estado, sesion_vence_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const s = data as {
    id: string; persona_id: string; persona_nombre: string | null
    grupo_id: string | null; punto_id: string | null
    estado: string; sesion_vence_at: string | null
  }
  if (s.estado !== 'ACTIVA') return null
  if (!s.sesion_vence_at || new Date(s.sesion_vence_at) <= new Date()) return null
  return {
    sesionId: s.id,
    personaId: s.persona_id,
    personaNombre: s.persona_nombre,
    grupoId: s.grupo_id,
    puntoId: s.punto_id,
    venceAt: s.sesion_vence_at,
  }
}

/** Opciones de la cookie. `httpOnly` para que ningún script la lea, `lax` para
 *  que sobreviva al salto desde el enlace que llegó por WhatsApp. */
export function opcionesCookie(venceAt: string) {
  return {
    name: COOKIE_SESION,
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(venceAt),
  }
}

/** La persona que está trabajando, venga de una cuenta o de un enlace + PIN.
 *  Es lo que necesitan las pantallas de campo para saber a nombre de quién
 *  abrir la visita. */
export interface ActorCampo {
  personaId: string
  personaNombre: string | null
  usuarioId: string | null
  sesionId: string | null
  metodo: 'CUENTA' | 'ENLACE_PIN'
  grupoId: string | null
}

/**
 * Quién está trabajando, mirando las dos identidades en orden: primero la
 * cuenta de Supabase Auth (más fuerte) y después la sesión de campo.
 *
 * Es lo que llaman las páginas de `/campo` para saber a nombre de quién abrir
 * la visita. Devuelve null cuando no hay ninguna de las dos, y entonces la
 * pantalla manda a `/campo/entrar` conservando el destino.
 */
export async function actorDeCampo(): Promise<ActorCampo | null> {
  const { createClient } = await import('@/lib/supabase/server')
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (user) {
    const porCuenta = await actorDesdeCuenta(user.id)
    // Una cuenta sin persona vinculada no puede ejecutar: la visita necesita
    // saber QUIÉN la hizo, y `ronda_visitas.persona_id` es NOT NULL. Pasa con
    // las cuentas administrativas, que para esto entran por la consola.
    if (porCuenta) return porCuenta
  }
  const s = await sesionDeCampo()
  if (!s) return null
  return {
    personaId: s.personaId,
    personaNombre: s.personaNombre,
    usuarioId: null,
    sesionId: s.sesionId,
    metodo: 'ENLACE_PIN',
    grupoId: s.grupoId,
  }
}

/** Resuelve el actor desde la sesión de Supabase Auth, si la hay. */
export async function actorDesdeCuenta(usuarioId: string): Promise<ActorCampo | null> {
  const { data } = await getAdmin()
    .from('personas')
    .select('id, nombres, apellidos')
    .eq('usuario_id', usuarioId)
    .maybeSingle()
  if (!data) return null
  const p = data as { id: string; nombres: string | null; apellidos: string | null }
  const { data: u } = await getAdmin()
    .from('usuarios').select('grupo_id').eq('id', usuarioId).maybeSingle()
  return {
    personaId: p.id,
    personaNombre: `${p.nombres ?? ''} ${p.apellidos ?? ''}`.trim() || null,
    usuarioId,
    sesionId: null,
    metodo: 'CUENTA',
    grupoId: (u as { grupo_id: string | null } | null)?.grupo_id ?? null,
  }
}
