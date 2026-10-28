import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { procesarEnviosMasivos } from '@/lib/envios/procesar'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * El trabajador del ENVÍO MASIVO (Puntos QR F10).
 *
 * Toma los destinos cuya hora llegó y encola un mensaje POR PERSONA. No manda
 * nada: el que envía es `/api/cron/whatsapp-salida`, con el control de caudal
 * del número. Esta ruta y aquella usan el mismo número de mensajes por segundo
 * (lib/whatsapp/caudal.ts), que es lo que hace que el reparto de horas prometa
 * un ritmo que la cola de salida sí puede sostener.
 *
 * Lo que cae fuera de la jornada del contrato se APLAZA a la siguiente ventana
 * —salvo una emergencia autorizada— y queda registrado en `ronda_eventos`. El
 * portero de F9 lo vuelve a mirar al enviar: la §4.4 del complemento 2 exige el
 * control en los dos momentos.
 *
 * Misma convención que `/api/cron/correo`, y en `vercel.json` va cada minuto:
 * el escalonado reparte un envío grande a lo largo de varias vueltas.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Falta configuración de Supabase (service role)' }, { status: 500 })
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  try {
    const res = await procesarEnviosMasivos(supabase)
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    console.error('[cron/crm-envios]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falló el trabajador del envío masivo' }, { status: 500 })
  }
}
