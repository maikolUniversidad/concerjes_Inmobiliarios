import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { COOKIE_STATE, PROVEEDORES, canjearCodigo, correoDelIdToken, esProveedor } from '@/lib/email/oauth'

export const runtime = 'nodejs'

/**
 * Paso 2 del vínculo por OAuth: el proveedor devuelve el `code`, se canjea por
 * los tokens y se guarda el `refresh_token` con el que la plataforma renovará
 * el acceso. También se completan los servidores SMTP/IMAP del proveedor.
 */
export async function GET(req: NextRequest) {
  const destino = new URL('/integraciones/correo', req.nextUrl.origin)
  const params = req.nextUrl.searchParams

  const volverCon = (clave: string, detalle?: string) => {
    destino.searchParams.set('oauth', clave)
    if (detalle) destino.searchParams.set('detalle', detalle.slice(0, 200))
    return NextResponse.redirect(destino)
  }

  if (params.get('error')) {
    return volverCon('error', params.get('error_description') || params.get('error') || undefined)
  }

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return volverCon('error', 'El proveedor no devolvió el código de autorización.')

  const jar = await cookies()
  const guardado = jar.get(COOKIE_STATE)?.value
  jar.delete(COOKIE_STATE)
  if (!guardado) return volverCon('error', 'La autorización expiró. Vuelve a intentarlo.')

  const [stateGuardado, proveedor, cuentaId] = guardado.split(':')
  if (stateGuardado !== state || !esProveedor(proveedor)) {
    return volverCon('error', 'La autorización no coincide con esta sesión.')
  }

  const permisos = await getPermisosUsuario()
  if (!permisos.puede('gestionar_integraciones')) {
    return volverCon('error', 'No tienes permiso para conectar cuentas de correo.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any
  const { data: cuenta } = await supabase
    .from('integraciones_correo')
    .select('id, oauth_client_id, oauth_client_secret, oauth_tenant, from_email, smtp_host, imap_host')
    .eq('id', cuentaId).maybeSingle()

  if (!cuenta?.oauth_client_id || !cuenta?.oauth_client_secret) {
    return volverCon('falta_client')
  }

  try {
    const tokens = await canjearCodigo({
      proveedor,
      clientId: cuenta.oauth_client_id,
      clientSecret: cuenta.oauth_client_secret,
      tenant: cuenta.oauth_tenant,
      code,
    })

    if (!tokens.refresh_token) {
      return volverCon('sin_refresh')
    }

    const cfg = PROVEEDORES[proveedor]
    const correo = correoDelIdToken(tokens.id_token) || cuenta.from_email

    const { error } = await supabase.from('integraciones_correo').update({
      auth_tipo: 'OAUTH2',
      oauth_proveedor: proveedor,
      oauth_refresh_token: tokens.refresh_token,
      oauth_access_token: tokens.access_token,
      oauth_expira_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      oauth_scope: tokens.scope ?? cfg.scope,
      oauth_cuenta: correo,
      // Los servidores del proveedor quedan listos para enviar y recibir.
      smtp_host: cfg.smtp.host, smtp_port: cfg.smtp.port, smtp_secure: cfg.smtp.secure,
      imap_host: cfg.imap.host, imap_port: cfg.imap.port, imap_secure: cfg.imap.secure,
      smtp_user: correo, imap_user: correo,
      from_email: cuenta.from_email || correo,
      estado: 'SIN_PROBAR', ultimo_error: null,
    }).eq('id', cuenta.id)

    if (error) return volverCon('error', error.message)
    return volverCon('ok')
  } catch (e) {
    return volverCon('error', e instanceof Error ? e.message : 'No se pudo completar la autorización.')
  }
}
