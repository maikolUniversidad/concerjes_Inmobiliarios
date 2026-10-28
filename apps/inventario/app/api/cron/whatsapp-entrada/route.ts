import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { procesarEntrada } from '@/lib/whatsapp/motor'
import { procesarMedios } from '@/lib/whatsapp/medios'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * El trabajador de la cola de ENTRADA de WhatsApp.
 *
 * Hace lo que el webhook no puede hacer sin arriesgarse a un reintento de Meta:
 * baja los medios, corre la máquina de estados y encola las respuestas.
 *
 * Misma convención que `/api/cron/correo` y `/api/cron/flujos`: runtime nodejs,
 * `maxDuration = 60` y `Authorization: Bearer ${CRON_SECRET}`, que Vercel manda
 * solo. Lo que cambia es la frecuencia: en `vercel.json` va cada MINUTO, porque
 * los temporizadores de la máquina de estados son de minutos y un conserje que
 * espera cinco minutos una respuesta se va y hace la ronda en papel.
 *
 * El presupuesto es de 45 s sobre los 60 de la función: al agotarlo sale
 * ordenadamente y deja lo pendiente en la cola. El camino lento es la
 * garantía; nada se procesa dos veces.
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
    const eventos = await procesarEntrada(supabase, 40)
    // Los medios al final y con lo que quede de presupuesto: un archivo de 100
    // MB no puede dejar sin procesar los mensajes de nadie.
    const medios = await procesarMedios(supabase, 10)
    return NextResponse.json({ ok: true, eventos, medios })
  } catch (e) {
    console.error('[cron/whatsapp-entrada]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falló el trabajador de entrada' }, { status: 500 })
  }
}
