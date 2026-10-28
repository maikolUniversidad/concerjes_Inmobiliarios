import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { procesarSalida } from '@/lib/whatsapp/salida'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * El trabajador del buzón de SALIDA de WhatsApp, con control de caudal.
 *
 * El número en coexistencia tiene un tope FIJO de 20 mensajes por segundo y no
 * se puede subir. Se trabaja por debajo para dejar margen, y la cola ordena por
 * prioridad: primero las respuestas a quien está parado en un punto esperando,
 * después los avisos. Un aviso a 800 personas tarda alrededor de un minuto, no
 * es instantáneo, y eso es una propiedad del número, no un defecto del código.
 *
 * Cada fila vuelve a pasar por el portero antes de salir: un mensaje programado
 * para las 19:55 que sale a las 20:05 ya está fuera de jornada y NO se manda
 * (Ley 2191 de 2022).
 *
 * Misma convención que `/api/cron/correo`, y en `vercel.json` va cada minuto.
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
    const res = await procesarSalida(supabase, 50)
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    console.error('[cron/whatsapp-salida]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falló el trabajador de salida' }, { status: 500 })
  }
}
