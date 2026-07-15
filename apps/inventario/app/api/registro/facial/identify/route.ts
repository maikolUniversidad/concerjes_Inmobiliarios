import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

// Identificación facial 1:N (Ruta A). ENV-GATED: si no hay microservicio GPU
// configurado, responde disponible:false y la UI cae a la Ruta B (documento).
//
// Contrato del microservicio (FastAPI sobre GPU on-premise, InsightFace):
//   POST {FACIAL_SERVICE_URL}/face/identify   body: { image: <base64 jpeg> }
//   -> { embedding: number[512], quality: number, liveness_score: number }
//
// Este endpoint aplica los umbrales (env) y devuelve MATCH | DUDA | NO_MATCH.
export async function POST(req: NextRequest) {
  const url = process.env.FACIAL_SERVICE_URL
  if (!url) return NextResponse.json({ disponible: false })

  const uid = await uidDesdeToken(req.headers.get('authorization'))
  if (!uid) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 })

  let body: { image?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 }) }
  if (!body.image) return NextResponse.json({ error: 'Falta la imagen.' }, { status: 400 })

  const MATCH = Number(process.env.FACIAL_UMBRAL_MATCH ?? '0.50')
  const DUDA = Number(process.env.FACIAL_UMBRAL_DUDA ?? '0.38')
  const LIVENESS = Number(process.env.FACIAL_LIVENESS_MIN ?? '0.90')

  // 1) Embedding + liveness en el microservicio.
  let emb: { embedding: number[]; quality: number; liveness_score: number | null }
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/face/identify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.FACIAL_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.FACIAL_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ image: body.image }),
    })
    if (!r.ok) return NextResponse.json({ error: 'El servicio facial no respondió.' }, { status: 502 })
    emb = await r.json()
  } catch {
    return NextResponse.json({ disponible: false })
  }

  const admin = getAdmin()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? null
  const ua = req.headers.get('user-agent')

  // liveness_score = null → el motor no tiene anti-spoofing (serverless sin torch).
  // Aquí solo IDENTIFICAMOS para sugerir identidad, y la app SIEMPRE exige el 2º
  // factor antes de mostrar datos personales, así que se permite continuar.
  // Si hay motor y el puntaje es bajo, se rechaza.
  if (emb.liveness_score != null && emb.liveness_score < LIVENESS) {
    await admin.from('intentos_identificacion').insert({ resultado: 'LIVENESS_FAIL', score: emb.liveness_score, ip, user_agent: ua })
    return NextResponse.json({ resultado: 'LIVENESS_FAIL' })
  }

  // 2) Búsqueda 1:N por similitud coseno (RPC pgvector, service role).
  const { data, error } = await admin.rpc('vac_buscar_rostro', { p_embedding: emb.embedding, p_limite: 3 })
  if (error) return NextResponse.json({ error: 'Búsqueda no disponible.' }, { status: 500 })

  const mejor = (data as { candidato_id: string; similitud: number }[])?.[0]
  const score = mejor?.similitud ?? 0
  let resultado: 'MATCH' | 'DUDA' | 'NO_MATCH'
  if (score >= MATCH) resultado = 'MATCH'
  else if (score >= DUDA) resultado = 'DUDA'
  else resultado = 'NO_MATCH'

  await admin.from('intentos_identificacion').insert({
    resultado, score, candidato_id: resultado === 'MATCH' ? mejor.candidato_id : null, ip, user_agent: ua,
  })

  // MATCH solo SUGIERE identidad → la UI pide 2º factor (últimos 4) antes de
  // mostrar datos personales. No devolvemos datos del candidato aquí.
  return NextResponse.json({
    resultado,
    candidato_id: resultado === 'MATCH' ? mejor.candidato_id : null,
  })
}
