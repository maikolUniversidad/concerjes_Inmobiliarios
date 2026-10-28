import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { barrerSlaCrm } from '@/lib/crm/barrido'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * El barrido del SLA de los casos del CRM (F11).
 *
 * Marca `incumplido` lo que pasó su tope sin cumplirlo y dispara el evento
 * `CRM_SLA_INCUMPLIDO`, una sola vez por caso. Todo el trabajo lo hace
 * `crm_sla_barrer()` en la base, y la razón no es elegancia: el cálculo tiene
 * que ser el mismo que calculó el plazo, y el plazo lo calculó la base.
 *
 * Va cada CINCO minutos y no cada minuto, a diferencia de los tres crons de F9:
 * los relojes de la §4 del ADR-01 son de minutos porque hay alguien parado en un
 * punto esperando una respuesta, pero un SLA que se marca incumplido cuatro
 * minutos tarde no cambia nada para nadie. Y un barrido por minuto sobre los
 * casos del mes es una consulta que no hace falta.
 *
 * LO QUE ESTE CRON NO HACE, a propósito: no responde, no escala, no reasigna.
 * Avisa. Nada de este módulo manda un mensaje sin que una persona lo apruebe.
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
    const r = await barrerSlaCrm(supabase, 200)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[cron/crm-sla]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Falló el barrido del SLA del CRM' }, { status: 500 })
  }
}
