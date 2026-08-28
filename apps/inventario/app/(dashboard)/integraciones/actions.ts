'use server'

import { ImapFlow } from 'imapflow'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { procesarCorreoSaliente } from '@/lib/email/procesar'
import { esProveedor } from '@/lib/email/oauth'
import {
  authImap, cargarCuenta, crearTransporte, motivoNoEnvia, puedeEnviar, remitente, type CuentaCorreo,
} from '@/lib/email/transport'

export interface ActionResult { error?: string; ok?: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/** Configuración de la cuenta de correo (SMTP/IMAP con contraseña u OAuth). */
export type CorreoConfig = CuentaCorreo

async function auth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function cargar(supabase: DB): Promise<CorreoConfig | null> {
  return cargarCuenta(supabase)
}

/**
 * Guarda la configuración de correo. Conserva las contraseñas y el secreto de
 * OAuth si se dejan vacíos, para no obligar a reescribirlos en cada cambio.
 */
export async function guardarCorreo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const prev = await cargar(supabase)
  const str = (k: string) => String(formData.get(k) ?? '').trim() || null
  const int = (k: string, def: number) => { const n = Number(formData.get(k)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : def }

  const authTipo = String(formData.get('auth_tipo') ?? 'PASSWORD') === 'OAUTH2' ? 'OAUTH2' : 'PASSWORD'
  const proveedor = str('oauth_proveedor')

  const smtpPass = str('smtp_pass') ?? prev?.smtp_pass ?? null
  const imapPass = str('imap_pass') ?? prev?.imap_pass ?? null
  const clientSecret = str('oauth_client_secret') ?? prev?.oauth_client_secret ?? null

  const fila = {
    nombre: str('nombre') ?? 'Correo principal',
    from_nombre: str('from_nombre'),
    from_email: str('from_email'),
    auth_tipo: authTipo,
    oauth_proveedor: authTipo === 'OAUTH2' && esProveedor(proveedor) ? proveedor : null,
    oauth_client_id: authTipo === 'OAUTH2' ? str('oauth_client_id') : prev?.oauth_client_id ?? null,
    oauth_client_secret: authTipo === 'OAUTH2' ? clientSecret : prev?.oauth_client_secret ?? null,
    oauth_tenant: str('oauth_tenant') ?? 'common',
    smtp_host: str('smtp_host'), smtp_port: int('smtp_port', 587), smtp_secure: formData.get('smtp_secure') === 'on',
    smtp_user: str('smtp_user') ?? str('from_email'), smtp_pass: smtpPass, envio_activo: formData.get('envio_activo') === 'on',
    imap_host: str('imap_host'), imap_port: int('imap_port', 993), imap_secure: formData.get('imap_secure') !== 'off',
    imap_user: str('imap_user') ?? str('from_email'), imap_pass: imapPass, recepcion_activa: formData.get('recepcion_activa') === 'on',
  }

  if (!fila.from_email) return { error: 'Ingresa el correo de la cuenta.' }
  if (authTipo === 'OAUTH2' && !esProveedor(proveedor)) return { error: 'Elige el proveedor de OAuth (Google o Microsoft).' }
  if (authTipo === 'OAUTH2' && !fila.oauth_client_id) return { error: 'Ingresa el Client ID de la aplicación del proveedor.' }

  // Cambiar de proveedor invalida la autorización anterior.
  const cambioProveedor = authTipo === 'OAUTH2' && prev?.oauth_proveedor && prev.oauth_proveedor !== proveedor
  const limpiarTokens = cambioProveedor
    ? { oauth_refresh_token: null, oauth_access_token: null, oauth_expira_at: null, oauth_cuenta: null }
    : {}

  let error
  if (prev?.id) {
    ({ error } = await (supabase as DB).from('integraciones_correo').update({ ...fila, ...limpiarTokens }).eq('id', prev.id))
  } else {
    ({ error } = await (supabase as DB).from('integraciones_correo').insert({ ...fila, predeterminada: true }))
  }
  if (error) {
    if (/row-level security|permission/i.test(error.message)) return { error: 'Solo un administrador puede configurar el correo.' }
    return { error: 'No se pudo guardar: ' + error.message }
  }

  await logActivity(supabase, { accion: 'UPDATE', modulo: 'Integraciones', descripcion: `Configuró el correo ${fila.from_email}`, entidad: 'IntegracionCorreo' })
  revalidatePath('/integraciones/correo'); revalidatePath('/integraciones')
  return { ok: true }
}

/** Verifica la conexión SMTP (envío) y guarda el estado. */
export async function probarConexion(): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const cfg = await cargar(supabase)
  if (!puedeEnviar(cfg)) return { error: motivoNoEnvia(cfg) }

  try {
    const transport = await crearTransporte(supabase, cfg)
    await transport.verify()
    await (supabase as DB).from('integraciones_correo')
      .update({ estado: 'OK', ultimo_test: new Date().toISOString(), ultimo_error: null }).eq('id', cfg.id)
    revalidatePath('/integraciones/correo'); revalidatePath('/integraciones')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error de conexión'
    await (supabase as DB).from('integraciones_correo')
      .update({ estado: 'ERROR', ultimo_test: new Date().toISOString(), ultimo_error: msg }).eq('id', cfg.id)
    revalidatePath('/integraciones/correo')
    return { error: 'No se pudo conectar por SMTP: ' + msg }
  }
}

/** Envía un correo de prueba a la dirección indicada (o a la propia cuenta). */
export async function enviarPrueba(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const cfg = await cargar(supabase)
  if (!puedeEnviar(cfg)) return { error: motivoNoEnvia(cfg) }

  const para = String(formData.get('para') ?? '').trim() || cfg.from_email!
  try {
    const transport = await crearTransporte(supabase, cfg)
    await transport.sendMail({
      from: remitente(cfg),
      to: para,
      subject: 'Correo de prueba · Conserjes Inmobiliarios',
      text: 'Este es un correo de prueba enviado desde la plataforma de Conserjes Inmobiliarios. La integración de correo funciona correctamente.',
      html: '<p>Este es un <strong>correo de prueba</strong> enviado desde la plataforma de <strong>Conserjes Inmobiliarios</strong>.</p><p>La integración de correo funciona correctamente ✅</p>',
    })
    await logActivity(supabase, { accion: 'CREATE', modulo: 'Integraciones', descripcion: `Envió correo de prueba a ${para}`, entidad: 'IntegracionCorreo' })
    return { ok: true }
  } catch (e) {
    return { error: 'No se pudo enviar: ' + (e instanceof Error ? e.message : 'error') }
  }
}

/** Revoca localmente la autorización OAuth: hay que volver a conectar la cuenta. */
export async function desconectarOauth(): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const cfg = await cargar(supabase)
  if (!cfg) return { error: 'No hay una cuenta configurada.' }

  const { error } = await (supabase as DB).from('integraciones_correo').update({
    oauth_refresh_token: null, oauth_access_token: null, oauth_expira_at: null,
    oauth_cuenta: null, estado: 'SIN_PROBAR', ultimo_error: null,
  }).eq('id', cfg.id)
  if (error) return { error: 'No se pudo desconectar: ' + error.message }

  await logActivity(supabase, {
    accion: 'UPDATE', modulo: 'Integraciones',
    descripcion: 'Desconectó la autorización OAuth del correo', entidad: 'IntegracionCorreo',
  })
  revalidatePath('/integraciones/correo')
  return { ok: true }
}

/** Envía manualmente los correos pendientes del buzón (alertas por email). */
export async function procesarPendientes(): Promise<{ ok?: boolean; error?: string; enviados?: number; errores?: number }> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const res = await procesarCorreoSaliente(supabase, 50)
  if (res.sinConfig) return { error: motivoNoEnvia(await cargar(supabase)) || 'Configura y activa el envío (SMTP) primero.' }
  revalidatePath('/integraciones/correo')
  return { ok: true, enviados: res.enviados, errores: res.errores }
}

export interface MensajeBandeja {
  uid: number; asunto: string; de: string; fecha: string | null; leido: boolean
}

/** Lee los últimos mensajes de la bandeja de entrada por IMAP. */
export async function leerBandeja(): Promise<{ ok?: boolean; error?: string; mensajes?: MensajeBandeja[] }> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const cfg = await cargar(supabase)
  if (!cfg) return { error: 'Primero guarda la configuración.' }
  if (!cfg.recepcion_activa) return { error: 'La recepción (IMAP) está desactivada.' }
  if (!cfg.imap_host) return { error: 'Falta el servidor IMAP.' }

  let credenciales
  try {
    credenciales = await authImap(supabase, cfg)
  } catch (e) {
    return { error: 'No se pudo autorizar la lectura: ' + (e instanceof Error ? e.message : 'error') }
  }
  if (!credenciales.pass && !credenciales.accessToken) return { error: 'Faltan las credenciales de IMAP.' }

  const client = new ImapFlow({
    host: cfg.imap_host, port: cfg.imap_port, secure: cfg.imap_secure,
    // ImapFlow acepta contraseña o token XOAUTH2 en el mismo campo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    auth: credenciales as any, logger: false,
  })
  try {
    await client.connect()
    const mensajes: MensajeBandeja[] = []
    const lock = await client.getMailboxLock('INBOX')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const total = (client.mailbox as any)?.exists ?? 0
      if (total > 0) {
        const desde = Math.max(1, total - 19)
        for await (const msg of client.fetch(`${desde}:*`, { envelope: true, flags: true })) {
          mensajes.push({
            uid: msg.uid,
            asunto: msg.envelope?.subject || '(sin asunto)',
            de: msg.envelope?.from?.[0]?.address || msg.envelope?.from?.[0]?.name || '—',
            fecha: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
            leido: msg.flags?.has('\\Seen') ?? false,
          })
        }
      }
    } finally {
      lock.release()
    }
    await client.logout()
    mensajes.reverse()
    return { ok: true, mensajes }
  } catch (e) {
    try { await client.close() } catch { /* noop */ }
    return { error: 'No se pudo leer la bandeja por IMAP: ' + (e instanceof Error ? e.message : 'error') }
  }
}

