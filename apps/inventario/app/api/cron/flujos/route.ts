import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { procesarFlujosPendientes } from '@/lib/notificaciones/worker'
import { procesarCorreoSaliente } from '@/lib/email/procesar'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Motor de flujos de notificación: ejecuta los pasos programados que ya
 * vencieron (incluidos los escalamientos con demora) y a continuación despacha
 * los correos que esos pasos hayan encolado.
 *
 * Lo invoca el cron de Vercel. Si CRON_SECRET está definido, exige el header
 * Authorization: Bearer <CRON_SECRET> (Vercel lo añade automáticamente).
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
  const flujos = await procesarFlujosPendientes(supabase, 50)
  // Los correos recién encolados salen en la misma pasada, sin esperar al otro cron.
  const correo = await procesarCorreoSaliente(supabase, 50)

  return NextResponse.json({ ok: true, flujos, correo })
}
