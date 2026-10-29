import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { barrerUbicacion } from '@/lib/ronda/barrido-ubicacion'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * El mantenimiento del rastro de ubicación (F8).
 *
 * Borra el rastro que pasó la retención del contrato (3 meses por omisión) y
 * cierra los turnos que se quedaron abiertos pasada su hora prevista.
 *
 * POR QUÉ EXISTE ESTA RUTA: las dos funciones de la base estaban escritas y
 * probadas desde F8, pero no las llamaba nadie. Mientras así fuera, **la
 * retención que el módulo promete no existía** y el rastro de cada persona se
 * guardaba para siempre. Dar el permiso del recorrido sin esto era abrir una
 * ventana que no se cierra nunca.
 *
 * VA CADA HORA, no cada minuto ni una vez al día. Cada minuto sería una consulta
 * de borrado por minuto para algo que no tiene ninguna urgencia. Una vez al día
 * concentraría toda la purga en un solo borrado grande y dejaría un turno
 * vencido abierto hasta 24 h, que ensucia el indicador de quién está en turno.
 * Cada hora reparte el trabajo en pedazos pequeños y acota el desfase.
 *
 * NO BORRA NADA QUE NO TOQUE: la retención la decide cada contrato
 * (`retencion_ubicacion_meses`), la lee la propia función en la base, y acá no
 * se pasa ninguna fecha. Esta ruta no sabe —ni tiene por qué— cuánto conserva
 * cada cliente.
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
    const r = await barrerUbicacion(supabase)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[cron/ubicacion]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falló el mantenimiento del rastro de ubicación' }, { status: 500 })
  }
}
