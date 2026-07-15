import { NextResponse } from 'next/server'

// Diagnóstico del flujo público: consulta la configuración de Auth del proyecto
// Supabase (/auth/v1/settings) y dice si el registro anónimo está habilitado.
// No expone secretos: usa la anon key (que ya es pública en el bundle del cliente).
// Se puede borrar cuando el flujo esté estable.
export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      problema: 'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel.',
      env: { url: !!url, anon_key: !!key, service_role_key: !!service },
    }, { status: 500 })
  }

  let settings: Record<string, unknown> = {}
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: key },
      cache: 'no-store',
    })
    settings = await r.json()
  } catch (e) {
    return NextResponse.json({ ok: false, problema: 'No se pudo consultar Supabase: ' + String(e) }, { status: 502 })
  }

  const external = (settings.external ?? {}) as Record<string, unknown>
  const anonimoHabilitado = external.anonymous_users === true
  const signupsDeshabilitados = settings.disable_signup === true

  const problemas: string[] = []
  if (!anonimoHabilitado) {
    problemas.push('Anonymous Sign-Ins está APAGADO → Authentication → Sign In / Providers → Anonymous Sign-Ins = ON')
  }
  if (signupsDeshabilitados) {
    problemas.push('"Allow new users to sign up" está APAGADO → Authentication → Sign In / Providers = ON (con esto apagado, el anónimo también falla con 422)')
  }
  if (!service) {
    problemas.push('Falta SUPABASE_SERVICE_ROLE_KEY en Vercel (necesaria para crear la cuenta al final del registro).')
  }

  return NextResponse.json({
    ok: problemas.length === 0,
    proyecto: url,
    anonimo_habilitado: anonimoHabilitado,
    signups_deshabilitados: signupsDeshabilitados,
    service_role_key_presente: !!service,
    problemas,
    conclusion: problemas.length === 0
      ? 'Configuración correcta: el registro anónimo debería funcionar. Recarga /registro-vacantes con Ctrl+Shift+R.'
      : 'Corrige lo listado en "problemas" y recarga /registro-vacantes.',
  })
}
