import 'server-only'

/**
 * OAuth 2.0 para las cuentas de correo (Google Workspace / Gmail y Microsoft 365
 * / Outlook). Alternativa a la contraseña de aplicación: el administrador
 * autoriza la cuenta una vez y la plataforma guarda un `refresh_token` con el
 * que renueva el acceso indefinidamente.
 *
 * El envío sigue siendo SMTP: lo que cambia es que en vez de contraseña se
 * presenta un token XOAUTH2.
 */

export type ProveedorOAuth = 'GOOGLE' | 'MICROSOFT'

/** Cookie de un solo uso que ata el callback a la sesión que inició el vínculo. */
export const COOKIE_STATE = 'correo_oauth_state'

export interface ProveedorConfig {
  label: string
  /** Scopes mínimos para enviar por SMTP y leer por IMAP. */
  scope: string
  smtp: { host: string; port: number; secure: boolean }
  imap: { host: string; port: number; secure: boolean }
  authUrl: (tenant: string) => string
  tokenUrl: (tenant: string) => string
  /** Parámetros extra del paso de autorización. */
  extraAuth: Record<string, string>
}

export const PROVEEDORES: Record<ProveedorOAuth, ProveedorConfig> = {
  GOOGLE: {
    label: 'Google (Gmail / Workspace)',
    scope: 'https://mail.google.com/ email',
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    authUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    // offline + consent son los que garantizan que Google devuelva refresh_token.
    extraAuth: { access_type: 'offline', prompt: 'consent' },
  },
  MICROSOFT: {
    label: 'Microsoft 365 / Outlook',
    scope: 'offline_access openid email https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All',
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    authUrl: (tenant) => `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0/authorize`,
    tokenUrl: (tenant) => `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0/token`,
    extraAuth: { prompt: 'consent' },
  },
}

export function esProveedor(v: string | null | undefined): v is ProveedorOAuth {
  return v === 'GOOGLE' || v === 'MICROSOFT'
}

/** URL absoluta a la que los proveedores devuelven el código de autorización. */
export function redirectUri(): string {
  const base = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  return `${base}/api/integraciones/correo/oauth/callback`
}

export interface TokensOAuth {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
}

/** Arma la URL de consentimiento a la que se envía al administrador. */
export function urlAutorizacion(params: {
  proveedor: ProveedorOAuth
  clientId: string
  tenant?: string | null
  state: string
  loginHint?: string | null
}): string {
  const cfg = PROVEEDORES[params.proveedor]
  const url = new URL(cfg.authUrl(params.tenant || 'common'))
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', cfg.scope)
  url.searchParams.set('state', params.state)
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint)
  for (const [k, v] of Object.entries(cfg.extraAuth)) url.searchParams.set(k, v)
  return url.toString()
}

async function pedirTokens(
  proveedor: ProveedorOAuth,
  tenant: string | null | undefined,
  body: Record<string, string>,
): Promise<TokensOAuth> {
  const res = await fetch(PROVEEDORES[proveedor].tokenUrl(tenant || 'common'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detalle = json?.error_description || json?.error || `HTTP ${res.status}`
    throw new Error(`El proveedor rechazó la autorización: ${detalle}`)
  }
  return json as TokensOAuth
}

/** Canjea el `code` del callback por access + refresh token. */
export function canjearCodigo(params: {
  proveedor: ProveedorOAuth
  clientId: string
  clientSecret: string
  tenant?: string | null
  code: string
}): Promise<TokensOAuth> {
  return pedirTokens(params.proveedor, params.tenant, {
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    code: params.code,
  })
}

/** Renueva el access token con el refresh token guardado. */
export function refrescarToken(params: {
  proveedor: ProveedorOAuth
  clientId: string
  clientSecret: string
  tenant?: string | null
  refreshToken: string
}): Promise<TokensOAuth> {
  return pedirTokens(params.proveedor, params.tenant, {
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    scope: PROVEEDORES[params.proveedor].scope,
  })
}

/** Lee el correo de la cuenta autorizada desde el id_token (sin validar firma). */
export function correoDelIdToken(idToken?: string): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return json.email || json.preferred_username || json.upn || null
  } catch {
    return null
  }
}
