import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { agenteDeSolicitud, ipDeSolicitud } from '@/lib/campo/peticion'
import { armarCookie, opcionesCookie } from '@/lib/campo/sesion'

export const runtime = 'nodejs'

/**
 * Quema el enlace de un uso: token + PIN → cookie de sesión de campo.
 *
 * La validación la hace `ronda_acceso_verificar()` en la base (cinco intentos
 * de PIN, un solo uso, vencimiento), y cada error queda en `ronda_eventos`: es
 * la señal de que alguien está probando enlaces, y es gratis registrarla.
 *
 * Los mensajes dicen lo justo. «PIN incorrecto, te quedan 3 intentos» ayuda a
 * quien se equivocó tecleando con guantes; decir además si el enlace existía o
 * de quién era no ayuda a nadie salvo a quien está probando.
 */
export async function POST(req: NextRequest) {
  let cuerpo: { token?: string; pin?: string }
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }
  const token = (cuerpo.token ?? '').trim()
  const pin = (cuerpo.pin ?? '').trim()
  if (!token || !/^[0-9]{4,8}$/.test(pin)) {
    return NextResponse.json({ ok: false, mensaje: 'Escribe el PIN que te llegó.' })
  }

  const { data, error } = await getAdmin().rpc('ronda_acceso_verificar', {
    p_token: token,
    p_pin: pin,
    p_ip: ipDeSolicitud(req),
    p_user_agent: agenteDeSolicitud(req),
  })
  if (error) {
    console.error('[campo/verificar] error de la RPC', error.message)
    return NextResponse.json({ error: 'No se pudo verificar el acceso.' }, { status: 500 })
  }

  const r = (data ?? {}) as {
    ok?: boolean; motivo?: string; intentos_restantes?: number
    sesion_id?: string; persona_nombre?: string; destino_ruta?: string | null
    punto_id?: string | null; vence_at?: string
  }

  if (!r.ok) {
    const mensajes: Record<string, string> = {
      NO_EXISTE: 'El enlace no sirve. Pide uno nuevo.',
      VENCIDA: 'El enlace se venció. Pide uno nuevo.',
      YA_USADA: 'Ese enlace ya se usó. Pide uno nuevo.',
      ANULADA: 'Ese enlace fue anulado. Habla con tu supervisor.',
      BLOQUEADA: 'Demasiados intentos. Pide un enlace nuevo.',
      PIN_INCORRECTO: r.intentos_restantes
        ? `PIN incorrecto. Te quedan ${r.intentos_restantes} intentos.`
        : 'PIN incorrecto.',
    }
    return NextResponse.json({
      ok: false,
      mensaje: mensajes[r.motivo ?? ''] ?? 'No se pudo entrar.',
      motivo: r.motivo,
    })
  }

  const res = NextResponse.json({
    ok: true,
    nombre: r.persona_nombre ?? null,
    destino: r.destino_ruta ?? (r.punto_id ? `/campo/punto/${r.punto_id}` : '/campo'),
    venceAt: r.vence_at,
  })
  res.cookies.set({
    ...opcionesCookie(r.vence_at as string),
    value: armarCookie(r.sesion_id as string),
  })
  return res
}

/** Salir: cierra la sesión en la base y borra la cookie. Cerrar tiene que
 *  surtir efecto de inmediato, y por eso se anula la fila y no solo la cookie. */
export async function DELETE() {
  const { sesionDeCampo, COOKIE_SESION } = await import('@/lib/campo/sesion')
  const s = await sesionDeCampo()
  if (s) {
    await getAdmin().rpc('ronda_sesion_cerrar', {
      p_sesion: s.sesionId, p_motivo: 'La persona cerró la sesión',
    })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: COOKIE_SESION, value: '', path: '/', maxAge: 0 })
  return res
}
