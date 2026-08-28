import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { COOKIE_STATE, esProveedor, redirectUri, urlAutorizacion } from '@/lib/email/oauth'

export const runtime = 'nodejs'

/**
 * Paso 1 del vínculo por OAuth: envía al administrador a la pantalla de
 * consentimiento de Google o Microsoft. El Client ID/Secret debe estar guardado
 * antes en la configuración de correo.
 */
export async function GET(req: NextRequest) {
  const proveedor = req.nextUrl.searchParams.get('proveedor')
  if (!esProveedor(proveedor)) {
    return NextResponse.json({ error: 'Proveedor no soportado.' }, { status: 400 })
  }

  const permisos = await getPermisosUsuario()
  if (!permisos.puede('gestionar_integraciones')) {
    return NextResponse.json({ error: 'No tienes permiso para conectar cuentas de correo.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: cuenta } = await supabase
    .from('integraciones_correo')
    .select('id, oauth_client_id, oauth_tenant, from_email')
    .limit(1).maybeSingle()

  const c = cuenta as { id: string; oauth_client_id: string | null; oauth_tenant: string | null; from_email: string | null } | null
  if (!c?.oauth_client_id) {
    const url = new URL('/integraciones/correo', req.nextUrl.origin)
    url.searchParams.set('oauth', 'falta_client')
    return NextResponse.redirect(url)
  }

  const state = randomUUID()
  const jar = await cookies()
  jar.set(COOKIE_STATE, `${state}:${proveedor}:${c.id}`, {
    httpOnly: true,
    sameSite: 'lax',
    // En desarrollo la app corre en http://localhost: marcar la cookie como
    // segura ahí impediría que volviera en el callback.
    secure: redirectUri().startsWith('https://'),
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(urlAutorizacion({
    proveedor,
    clientId: c.oauth_client_id,
    tenant: c.oauth_tenant,
    state,
    loginHint: c.from_email,
  }))
}
