import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { procesarVencimientos } from '@/lib/whatsapp/motor'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Los temporizadores de la máquina de estados y el cierre de jornada.
 *
 * Va cada MINUTO en `vercel.json`, porque los relojes de la §4 del ADR-01 son de
 * minutos: un recordatorio de ubicación a los 2 minutos que llega a los 6 ya no
 * sirve de nada.
 *
 * Y es el que aplica la §7.3: cuando termina el turno, una visita a medias pasa
 * a `EN_ESPERA_FUERA_DE_JORNADA`, se genera el reporte como borrador y EL BOT
 * DEJA DE ESCRIBIR. Ni recordatorios, ni plantillas, ni «no olvides». Eso es el
 * art. 3 de la Ley 2191 de 2022, no una preferencia de diseño.
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
    const res = await procesarVencimientos(supabase, 100)
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    console.error('[cron/whatsapp-vencimientos]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falló el trabajador de vencimientos' }, { status: 500 })
  }
}
