import 'server-only'
import { cargarCuenta, crearTransporte, puedeEnviar, remitente } from './transport'
import { htmlATexto } from './plantillas'

const BASE_URL = process.env.APP_BASE_URL || 'https://concerjes-inmobiliarios-inventario.vercel.app'
const MAX_INTENTOS = 5

export interface ResultadoProceso { enviados: number; errores: number; sinConfig?: boolean }

interface CorreoPendiente {
  id: string
  para: string
  asunto: string | null
  cuerpo_texto: string | null
  cuerpo_html: string | null
  copia: string | null
  copia_oculta: string | null
  enlace: string | null
  intentos: number
  cuenta_id: string | null
}

/** Envoltura por defecto para los correos que no traen HTML propio. */
function plantillaBase(cuerpo: string, href: string): string {
  const link = href ? `<p style="margin-top:12px"><a href="${href}">Ver en la plataforma</a></p>` : ''
  return `<div style="font-family:Arial,sans-serif;color:#1f2937"><p>${cuerpo}</p>${link}` +
    '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">' +
    '<p style="font-size:12px;color:#9ca3af">Conserjes Inmobiliarios · notificación automática</p></div>'
}

/**
 * Envía los correos PENDIENTES del buzón `correo_saliente` con la cuenta de
 * correo configurada (contraseña de aplicación u OAuth de Google/Microsoft).
 * Reutilizable desde el cron (service role) y desde una acción de administrador.
 * No lanza: reporta el resultado.
 */
export async function procesarCorreoSaliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  limite = 25,
): Promise<ResultadoProceso> {
  const cuenta = await cargarCuenta(supabase)
  if (!puedeEnviar(cuenta)) return { enviados: 0, errores: 0, sinConfig: true }

  const { data: pend } = await supabase
    .from('correo_saliente')
    .select('*')
    .eq('estado', 'PENDIENTE')
    .lt('intentos', MAX_INTENTOS)
    .order('created_at', { ascending: true })
    .limit(limite)

  const lista = (pend ?? []) as CorreoPendiente[]
  if (lista.length === 0) return { enviados: 0, errores: 0 }

  let transport
  try {
    transport = await crearTransporte(supabase, cuenta)
  } catch {
    // Falló la renovación del token OAuth: se reintenta en la próxima pasada.
    return { enviados: 0, errores: 0, sinConfig: true }
  }
  const from = remitente(cuenta)

  let enviados = 0, errores = 0
  for (const m of lista) {
    try {
      // El enlace puede venir absoluto (p. ej. avisos del portal de clientes,
      // que vive en otro dominio); sólo se antepone la base si es relativo.
      const href = m.enlace ? (/^https?:\/\//.test(m.enlace) ? m.enlace : `${BASE_URL}${m.enlace}`) : ''
      const html = m.cuerpo_html || plantillaBase(m.cuerpo_texto || '', href)
      await transport.sendMail({
        from,
        to: m.para,
        cc: m.copia || undefined,
        bcc: m.copia_oculta || undefined,
        subject: m.asunto || 'Notificación · Conserjes Inmobiliarios',
        text: m.cuerpo_texto || htmlATexto(html),
        html,
      })
      await supabase.from('correo_saliente').update({
        estado: 'ENVIADO', enviado_at: new Date().toISOString(), intentos: (m.intentos ?? 0) + 1, error: null,
      }).eq('id', m.id)
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
