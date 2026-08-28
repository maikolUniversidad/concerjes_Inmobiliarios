import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { esProveedor, refrescarToken } from './oauth'

/**
 * Construye el transporte SMTP a partir de la cuenta configurada en
 * `integraciones_correo`, sea cual sea su método de autenticación:
 *
 *   · PASSWORD → usuario + contraseña de aplicación (Gmail, Outlook, dominio propio).
 *   · OAUTH2   → token XOAUTH2 de Google o Microsoft; se renueva solo cuando
 *                está por vencer y el nuevo access token se guarda en la BD.
 *
 * Lo usan el envío de prueba, el buzón de salida y el worker de flujos.
 */

export interface CuentaCorreo {
  id: string
  nombre: string | null
  from_nombre: string | null
  from_email: string | null
  smtp_host: string | null
  smtp_port: number
  smtp_secure: boolean
  smtp_user: string | null
  smtp_pass: string | null
  envio_activo: boolean
  imap_host: string | null
  imap_port: number
  imap_secure: boolean
  imap_user: string | null
  imap_pass: string | null
  recepcion_activa: boolean
  auth_tipo: string | null
  oauth_proveedor: string | null
  oauth_client_id: string | null
  oauth_client_secret: string | null
  oauth_tenant: string | null
  oauth_refresh_token: string | null
  oauth_access_token: string | null
  oauth_expira_at: string | null
  oauth_cuenta: string | null
  estado: string
  ultimo_test: string | null
  ultimo_error: string | null
  predeterminada?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/** Margen antes de considerar vencido el access token (2 minutos). */
const MARGEN_MS = 120_000

/**
 * Carga una cuenta de correo. Sin `id`, devuelve la predeterminada (o la
 * primera configurada, para no romper instalaciones anteriores a esta columna).
 */
export async function cargarCuenta(supabase: DB, id?: string | null): Promise<CuentaCorreo | null> {
  if (id) {
    const { data } = await supabase.from('integraciones_correo').select('*').eq('id', id).maybeSingle()
    if (data) return data as CuentaCorreo
  }
  const { data: pred } = await supabase
    .from('integraciones_correo').select('*')
    .eq('predeterminada', true).limit(1).maybeSingle()
  if (pred) return pred as CuentaCorreo

  const { data } = await supabase
    .from('integraciones_correo').select('*')
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data as CuentaCorreo | null) ?? null
}

/** ¿La cuenta tiene lo mínimo para enviar? */
export function puedeEnviar(cuenta: CuentaCorreo | null): cuenta is CuentaCorreo {
  if (!cuenta || !cuenta.envio_activo || !cuenta.smtp_host || !cuenta.from_email) return false
  return cuenta.auth_tipo === 'OAUTH2'
    ? !!(cuenta.oauth_refresh_token && cuenta.oauth_client_id && cuenta.oauth_client_secret)
    : !!(cuenta.smtp_user && cuenta.smtp_pass)
}

/** Motivo legible por el que una cuenta no puede enviar (para la UI). */
export function motivoNoEnvia(cuenta: CuentaCorreo | null): string {
  if (!cuenta) return 'Todavía no hay una cuenta de correo configurada.'
  if (!cuenta.from_email) return 'Falta el correo de la cuenta.'
  if (!cuenta.envio_activo) return 'El envío está desactivado en la configuración.'
  if (!cuenta.smtp_host) return 'Falta el servidor SMTP.'
  if (cuenta.auth_tipo === 'OAUTH2') {
    if (!cuenta.oauth_client_id || !cuenta.oauth_client_secret) return 'Faltan el Client ID y el Client Secret del proveedor.'
    if (!cuenta.oauth_refresh_token) return 'La cuenta aún no está autorizada. Pulsa “Conectar” para dar el consentimiento.'
    return ''
  }
  if (!cuenta.smtp_user || !cuenta.smtp_pass) return 'Faltan el usuario o la contraseña de aplicación del SMTP.'
  return ''
}

/**
 * Devuelve un access token válido, renovándolo contra el proveedor cuando falta
 * poco para que venza. Persiste el token renovado para no pedirlo cada vez.
 */
export async function accessTokenVigente(supabase: DB, cuenta: CuentaCorreo): Promise<string> {
  const proveedor = cuenta.oauth_proveedor
  if (!esProveedor(proveedor)) throw new Error('Proveedor OAuth no soportado.')
  if (!cuenta.oauth_refresh_token) throw new Error('La cuenta no está autorizada (falta el refresh token).')

  const vence = cuenta.oauth_expira_at ? new Date(cuenta.oauth_expira_at).getTime() : 0
  if (cuenta.oauth_access_token && vence - Date.now() > MARGEN_MS) return cuenta.oauth_access_token

  const tokens = await refrescarToken({
    proveedor,
    clientId: cuenta.oauth_client_id!,
    clientSecret: cuenta.oauth_client_secret!,
    tenant: cuenta.oauth_tenant,
    refreshToken: cuenta.oauth_refresh_token,
  })

  const expiraAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  await supabase.from('integraciones_correo').update({
    oauth_access_token: tokens.access_token,
    oauth_expira_at: expiraAt,
    // Microsoft rota el refresh token en cada renovación; Google no lo reenvía.
    ...(tokens.refresh_token ? { oauth_refresh_token: tokens.refresh_token } : {}),
  }).eq('id', cuenta.id)

  cuenta.oauth_access_token = tokens.access_token
  cuenta.oauth_expira_at = expiraAt
  return tokens.access_token
}

/** Transporte SMTP listo para enviar con la cuenta indicada. */
export async function crearTransporte(supabase: DB, cuenta: CuentaCorreo): Promise<Transporter> {
  const base = {
    host: cuenta.smtp_host!,
    port: cuenta.smtp_port,
    secure: cuenta.smtp_secure,
    connectionTimeout: 12_000,
  }

  if (cuenta.auth_tipo === 'OAUTH2') {
    const accessToken = await accessTokenVigente(supabase, cuenta)
    return nodemailer.createTransport({
      ...base,
      auth: {
        type: 'OAuth2',
        user: cuenta.smtp_user || cuenta.oauth_cuenta || cuenta.from_email!,
        accessToken,
      },
    })
  }

  return nodemailer.createTransport({
    ...base,
    auth: { user: cuenta.smtp_user!, pass: cuenta.smtp_pass! },
  })
}

/** Remitente en formato `"Nombre" <correo>`. */
export function remitente(cuenta: CuentaCorreo): string {
  return cuenta.from_nombre ? `"${cuenta.from_nombre}" <${cuenta.from_email}>` : cuenta.from_email!
}

/** Credenciales IMAP (contraseña o XOAUTH2) para leer la bandeja. */
export async function authImap(
  supabase: DB,
  cuenta: CuentaCorreo,
): Promise<{ user: string; pass?: string; accessToken?: string }> {
  const user = cuenta.imap_user || cuenta.oauth_cuenta || cuenta.from_email || ''
  if (cuenta.auth_tipo === 'OAUTH2') {
    return { user, accessToken: await accessTokenVigente(supabase, cuenta) }
  }
  return { user, pass: cuenta.imap_pass ?? undefined }
}
