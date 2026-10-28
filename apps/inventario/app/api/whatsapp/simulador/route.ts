import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { appSecret, simuladorActivo } from '@/lib/whatsapp/config'
import { armarPayload, firmado, type EntradaSimulada } from '@/lib/whatsapp/simulador'
import { procesarEntrada, procesarVencimientos } from '@/lib/whatsapp/motor'
import { procesarSalida } from '@/lib/whatsapp/salida'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Inyecta un mensaje entrante como si viniera de Meta, y corre los trabajadores.
 *
 * TRES CANDADOS, porque esto escribe en la base de producción si se deja suelto:
 *   1. solo existe con `WHATSAPP_SIMULADOR=1`. Sin esa variable responde 404,
 *      no 403: una ruta de desarrollo no debería ni anunciar que existe;
 *   2. exige `Authorization: Bearer ${CRON_SECRET}`, el mismo secreto de los
 *      crons, que ya está en producción y no está en el repositorio;
 *   3. el payload se FIRMA con el app secret local y se manda por
 *      `/api/whatsapp/webhook`, así que pasa por la misma verificación de firma
 *      que un mensaje de Meta. No hay atajo.
 *
 * Y con `WHATSAPP_SIMULADOR=1` la capa de transporte es la simulada: nada sale
 * hacia un teléfono ni aunque la cuenta estuviera mal configurada.
 */
export async function POST(req: NextRequest) {
  if (!simuladorActivo()) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  }
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const secreto = appSecret()
  if (!secreto) {
    return NextResponse.json(
      { error: 'Falta WHATSAPP_APP_SECRET: sin él el simulador no puede firmar como Meta.' },
      { status: 500 },
    )
  }

  let cuerpo: {
    entrada?: EntradaSimulada
    /** Correr los trabajadores después de inyectar (por defecto, sí). */
    procesar?: boolean
    /** Disparar los temporizadores vencidos en vez de inyectar un mensaje. */
    vencimientos?: boolean
  }
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Falta configuración de Supabase (service role)' }, { status: 500 })
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const salida: Record<string, unknown> = {}

  if (cuerpo.entrada) {
    const payload = armarPayload(cuerpo.entrada)
    const { cuerpo: texto, firma } = firmado(payload, secreto)
    // Se manda por HTTP al propio webhook, a propósito: así el simulador prueba
    // la ruta pública de verdad (firma, tope de tamaño, deduplicación) y no una
    // llamada interna que se saltaría todo eso.
    const base = process.env.APP_BASE_URL || new URL(req.url).origin
    const r = await fetch(`${base}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': firma,
        'X-Whatsapp-Simulador': '1',
      },
      body: texto,
    })
    salida.webhook = { estado: r.status, cuerpo: await r.json().catch(() => null) }
    salida.payload = payload
  }

  if (cuerpo.vencimientos) {
    salida.vencimientos = await procesarVencimientos(supabase, 50)
  }

  if (cuerpo.procesar !== false) {
    salida.entrada = await procesarEntrada(supabase, 20)
    salida.salida = await procesarSalida(supabase, 20)
  }

  return NextResponse.json({ ok: true, ...salida })
}
