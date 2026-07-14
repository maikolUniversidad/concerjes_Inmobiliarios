import 'server-only'
import nodemailer from 'nodemailer'

const BASE_URL = process.env.APP_BASE_URL || 'https://concerjes-inmobiliarios-inventario.vercel.app'
const MAX_INTENTOS = 5

export interface ResultadoProceso { enviados: number; errores: number; sinConfig?: boolean }

/**
 * Envía los correos PENDIENTES del buzón `correo_saliente` usando la integración
 * SMTP configurada. Reutilizable desde el cron (service role) y desde una acción
 * de administrador (cliente de usuario). No lanza: reporta el resultado.
 */
export async function procesarCorreoSaliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  limite = 25,
): Promise<ResultadoProceso> {
  const { data: cfg } = await supabase.from('integraciones_correo').select('*').limit(1).maybeSingle()
  if (!cfg || !cfg.envio_activo || !cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass || !cfg.from_email) {
    return { enviados: 0, errores: 0, sinConfig: true }
  }

  const { data: pend } = await supabase
    .from('correo_saliente')
    .select('*')
    .eq('estado', 'PENDIENTE')
    .lt('intentos', MAX_INTENTOS)
    .order('created_at', { ascending: true })
    .limit(limite)

  const lista = (pend ?? []) as {
    id: string; para: string; asunto: string | null; cuerpo_texto: string | null; enlace: string | null; intentos: number
  }[]
  if (lista.length === 0) return { enviados: 0, errores: 0 }

  const transport = nodemailer.createTransport({
    host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_secure,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }, connectionTimeout: 12000,
  })
  const from = cfg.from_nombre ? `"${cfg.from_nombre}" <${cfg.from_email}>` : cfg.from_email

  let enviados = 0, errores = 0
  for (const m of lista) {
    try {
      const link = m.enlace ? `<p style="margin-top:12px"><a href="${BASE_URL}${m.enlace}">Ver en la plataforma</a></p>` : ''
      await transport.sendMail({
        from, to: m.para,
        subject: m.asunto || 'Notificación · Conserjes Inmobiliarios',
        text: m.cuerpo_texto || '',
        html: `<div style="font-family:Arial,sans-serif;color:#1f2937"><p>${m.cuerpo_texto || ''}</p>${link}<hr style="border:none;border-top:1px solid #eee;margin:16px 0"><p style="font-size:12px;color:#9ca3af">Conserjes Inmobiliarios · notificación automática</p></div>`,
      })
      await supabase.from('correo_saliente').update({ estado: 'ENVIADO', enviado_at: new Date().toISOString(), intentos: (m.intentos ?? 0) + 1, error: null }).eq('id', m.id)
      enviados++
    } catch (e) {
      const intentos = (m.intentos ?? 0) + 1
      await supabase.from('correo_saliente').update({
        estado: intentos >= MAX_INTENTOS ? 'ERROR' : 'PENDIENTE',
        intentos, error: e instanceof Error ? e.message : 'error',
      }).eq('id', m.id)
      errores++
    }
  }
  return { enviados, errores }
}
