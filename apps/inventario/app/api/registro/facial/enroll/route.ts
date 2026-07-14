import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

// Enrolamiento facial: al finalizar el registro, si el candidato autorizó el
// biométrico, se calcula el embedding y se guarda (NO la foto cruda).
// ENV-GATED: sin microservicio, responde disponible:false (no bloquea el flujo).
//
// Contrato: POST {FACIAL_SERVICE_URL}/face/enroll  body: { image }
//   -> { embedding: number[512], quality: number, liveness_score: number, modelo_version: string }
export async function POST(req: NextRequest) {
  const url = process.env.FACIAL_SERVICE_URL
  if (!url) return NextResponse.json({ disponible: false })

  const uid = await uidDesdeToken(req.headers.get('authorization'))
  if (!uid) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 })

  let body: { candidato_id?: string; image?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 }) }
  if (!body.candidato_id || !body.image) {
    return NextResponse.json({ error: 'Faltan datos.' }, { status: 400 })
  }

  const admin = getAdmin()
  // El candidato solo puede enrolar SU propio registro.
  const { data: cand } = await admin
    .from('candidatos').select('id, auth_uid').eq('id', body.candidato_id).maybeSingle()
  if (!cand || (cand as { auth_uid: string }).auth_uid !== uid) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  let emb: { embedding: number[]; quality: number; liveness_score: number; modelo_version: string }
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/face/enroll`, {
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

  // Retención: purga a 24 meses sin actividad (DECISIÓN 2 = B).
  const purga = new Date()
  purga.setMonth(purga.getMonth() + 24)

  const { error } = await admin.from('registros_faciales').insert({
    candidato_id: body.candidato_id,
    embedding: emb.embedding,
    modelo: 'buffalo_l',
    modelo_version: emb.modelo_version ?? 'desconocida',
    calidad: emb.quality,
    liveness_score: emb.liveness_score,
    purgar_despues_de: purga.toISOString().slice(0, 10),
  })
  if (error) return NextResponse.json({ error: 'No se pudo enrolar.' }, { status: 500 })

  await admin.from('vac_auditoria').insert({
    actor: uid, actor_tipo: 'CANDIDATO', accion: 'ENROLAR_BIOMETRICO',
    entidad: 'registros_faciales', entidad_id: body.candidato_id,
    user_agent: req.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true })
}
