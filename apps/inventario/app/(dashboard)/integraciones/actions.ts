'use server'

import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

export interface ActionResult { error?: string; ok?: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

export interface CorreoConfig {
  id: string
  nombre: string | null
  from_nombre: string | null
  from_email: string | null
  smtp_host: string | null; smtp_port: number; smtp_secure: boolean
  smtp_user: string | null; smtp_pass: string | null; envio_activo: boolean
  imap_host: string | null; imap_port: number; imap_secure: boolean
  imap_user: string | null; imap_pass: string | null; recepcion_activa: boolean
  estado: string; ultimo_test: string | null; ultimo_error: string | null
}

async function auth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function cargar(supabase: DB): Promise<CorreoConfig | null> {
  const { data } = await supabase.from('integraciones_correo').select('*').limit(1).maybeSingle()
  return (data as CorreoConfig | null) ?? null
}

/** Guarda la configuración de correo. Conserva las contraseñas si se dejan vacías. */
export async function guardarCorreo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const prev = await cargar(supabase)
  const str = (k: string) => String(formData.get(k) ?? '').trim() || null
  const int = (k: string, def: number) => { const n = Number(formData.get(k)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : def }

  const smtpPass = str('smtp_pass') ?? prev?.smtp_pass ?? null
  const imapPass = str('imap_pass') ?? prev?.imap_pass ?? null

  const fila = {
    nombre: str('nombre') ?? 'Correo principal',
    from_nombre: str('from_nombre'),
    from_email: str('from_email'),
    smtp_host: str('smtp_host'), smtp_port: int('smtp_port', 587), smtp_secure: formData.get('smtp_secure') === 'on',
    smtp_user: str('smtp_user') ?? str('from_email'), smtp_pass: smtpPass, envio_activo: formData.get('envio_activo') === 'on',
    imap_host: str('imap_host'), imap_port: int('imap_port', 993), imap_secure: formData.get('imap_secure') !== 'off',
    imap_user: str('imap_user') ?? str('from_email'), imap_pass: imapPass, recepcion_activa: formData.get('recepcion_activa') === 'on',
  }

  if (!fila.from_email) return { error: 'Ingresa el correo de la cuenta.' }

  let error
  if (prev?.id) {
    ({ error } = await (supabase as DB).from('integraciones_correo').update(fila).eq('id', prev.id))
  } else {
    ({ error } = await (supabase as DB).from('integraciones_correo').insert(fila))
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
  if (!cfg) return { error: 'Primero guarda la configuración.' }
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) return { error: 'Faltan datos de SMTP (servidor, usuario o contraseña).' }

  try {
    const transport = nodemailer.createTransport({
      host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_secure,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }, connectionTimeout: 12000,
    })
    await transport.verify()
    await (supabase as DB).from('integraciones_correo').update({ estado: 'OK', ultimo_test: new Date().toISOString(), ultimo_error: null }).eq('id', cfg.id)
    revalidatePath('/integraciones/correo'); revalidatePath('/integraciones')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error de conexión'
    await (supabase as DB).from('integraciones_correo').update({ estado: 'ERROR', ultimo_test: new Date().toISOString(), ultimo_error: msg }).eq('id', cfg.id)
    revalidatePath('/integraciones/correo')
    return { error: 'No se pudo conectar por SMTP: ' + msg }
  }
}

/** Envía un correo de prueba a la dirección indicada (o a la propia cuenta). */
export async function enviarPrueba(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const cfg = await cargar(supabase)
  if (!cfg) return { error: 'Primero guarda la configuración.' }
  if (!cfg.envio_activo) return { error: 'El envío está desactivado.' }
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass || !cfg.from_email) return { error: 'Faltan datos de SMTP.' }

  const para = String(formData.get('para') ?? '').trim() || cfg.from_email
  try {
    const transport = nodemailer.createTransport({
      host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_secure,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }, connectionTimeout: 12000,
    })
    await transport.sendMail({
      from: cfg.from_nombre ? `"${cfg.from_nombre}" <${cfg.from_email}>` : cfg.from_email,
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
  if (!cfg.imap_host || !cfg.imap_user || !cfg.imap_pass) return { error: 'Faltan datos de IMAP.' }

  const client = new ImapFlow({
    host: cfg.imap_host, port: cfg.imap_port, secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_pass }, logger: false,
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
