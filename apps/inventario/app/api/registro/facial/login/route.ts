import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'

// Login por reconocimiento facial. ENV-GATED: sin microservicio → disponible:false
// y la UI cae al ingreso por documento + contraseña.
//
// Flujo: microservicio /face/identify (embedding + liveness) → búsqueda 1:N
// (vac_buscar_rostro) → si MATCH, se emite un magic link para el usuario dueño
// del candidato y se devuelve el token_hash para que el cliente establezca sesión
// (supabase.auth.verifyOtp). La verificación de "persona real" la da el liveness
// pasivo del microservicio (MiniFASNet).
export async function POST(req: NextRequest) {
  const url = process.env.FACIAL_SERVICE_URL
  if (!url) return NextResponse.json({ disponible: false })

  let image = ''
  try { image = String((await req.json()).image ?? '') } catch { /* noop */ }
  if (!image) return NextResponse.json({ error: 'Falta la imagen.' }, { status: 400 })

  const MATCH = Number(process.env.FACIAL_UMBRAL_MATCH ?? '0.50')
  const LIVENESS = Number(process.env.FACIAL_LIVENESS_MIN ?? '0.90')
  const admin = getAdmin()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? null
  const ua = req.headers.get('user-agent')

  // 1) Embedding + liveness
  let emb: { embedding: number[]; liveness_score: number | null }
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/face/identify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.FACIAL_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.FACIAL_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ image }),
    })
    if (!r.ok) return NextResponse.json({ error: 'El servicio facial no respondió.' }, { status: 502 })
    emb = await r.json()
  } catch {
    return NextResponse.json({ disponible: false })
  }

  if (emb.liveness_score != null && emb.liveness_score < LIVENESS) {
    await admin.from('intentos_identificacion').insert({ resultado: 'LIVENESS_FAIL', score: emb.liveness_score, ip, user_agent: ua })
    return NextResponse.json({ resultado: 'LIVENESS_FAIL' })
  }
  // SEGURIDAD: sin anti-spoofing (liveness null) el rostro NO basta para otorgar
  // sesión — una foto impresa podría suplantar al candidato. En ese caso el
  // rostro solo sugiere identidad y se exige ingresar con documento+contraseña.
  const sinLiveness = emb.liveness_score == null

  // 2) Búsqueda 1:N
  const { data, error } = await admin.rpc('vac_buscar_rostro', { p_embedding: emb.embedding, p_limite: 1 })
  if (error) return NextResponse.json({ error: 'Búsqueda no disponible.' }, { status: 500 })
  const mejor = (data as { candidato_id: string; similitud: number }[])?.[0]
  if (!mejor || mejor.similitud < MATCH) {
    await admin.from('intentos_identificacion').insert({ resultado: 'NO_MATCH', score: mejor?.similitud ?? 0, ip, user_agent: ua })
    return NextResponse.json({ resultado: 'NO_MATCH' })
  }

  // Reconocido, pero sin prueba de vida no se otorga sesión.
  if (sinLiveness) {
    await admin.from('intentos_identificacion').insert({ resultado: 'MATCH', score: mejor.similitud, candidato_id: mejor.candidato_id, ip, user_agent: ua })
    return NextResponse.json({ resultado: 'MATCH', requiere2fa: true })
  }

  // 3) Usuario dueño del candidato → magic link
  const { data: cand } = await admin.from('candidatos').select('auth_uid').eq('id', mejor.candidato_id).maybeSingle()
  const authUid = (cand as { auth_uid: string | null } | null)?.auth_uid
  if (!authUid) return NextResponse.json({ resultado: 'NO_MATCH' })
  const { data: usr } = await admin.from('usuarios').select('email').eq('id', authUid).maybeSingle()
  const email = (usr as { email: string | null } | null)?.email
  if (!email) return NextResponse.json({ error: 'La cuenta aún no está activa. Ingresa con tu documento.' }, { status: 409 })

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 500 })
  }

  await admin.from('intentos_identificacion').insert({ resultado: 'MATCH', score: mejor.similitud, candidato_id: mejor.candidato_id, ip, user_agent: ua })
  await admin.from('vac_auditoria').insert({ actor: authUid, actor_tipo: 'CANDIDATO', accion: 'LOGIN_FACIAL', entidad: 'usuarios', entidad_id: authUid, user_agent: ua })

  return NextResponse.json({ resultado: 'MATCH', ok: true, token_hash: link.properties.hashed_token, email })
}
