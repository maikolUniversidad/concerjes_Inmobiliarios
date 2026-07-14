import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

// Ruta B — identificación por documento + reclamo del registro para esta sesión.
// La RLS impide que un anónimo lea candidatos ajenos; aquí (service role) se
// busca por documento, se valida el 2º factor (últimos 4) y se reasigna
// auth_uid al solicitante para que luego pueda leerlo/editarlo por RLS.
export async function POST(req: NextRequest) {
  let body: { tipo?: string; numero?: string; ultimos4?: string; uid?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ encontrado: false, error: 'Solicitud inválida.' }, { status: 400 })
  }

  const { tipo, numero, ultimos4 } = body
  const uid = await uidDesdeToken(req.headers.get('authorization'))
  if (!uid) return NextResponse.json({ encontrado: false, error: 'Sesión no válida.' }, { status: 401 })
  if (!tipo || !numero) {
    return NextResponse.json({ encontrado: false, error: 'Falta tipo o número de documento.' }, { status: 400 })
  }

  const admin = getAdmin()
  const { data: cand } = await admin
    .from('candidatos')
    .select('*')
    .eq('tipo_documento', tipo)
    .eq('numero_documento', numero.trim())
    .maybeSingle()

  if (!cand) return NextResponse.json({ encontrado: false })

  // 2º factor: últimos 4 dígitos del documento. Un MATCH nunca autentica solo.
  const num = String((cand as { numero_documento: string }).numero_documento)
  if (!ultimos4) {
    return NextResponse.json({ encontrado: true, requiereSegundoFactor: true })
  }
  if (num.slice(-4) !== ultimos4.trim()) {
    return NextResponse.json({ encontrado: true, requiereSegundoFactor: true, error: 'Los últimos 4 dígitos no coinciden.' })
  }

  // Reclama el registro para esta sesión anónima.
  const { error: upErr } = await admin
    .from('candidatos')
    .update({ auth_uid: uid })
    .eq('id', (cand as { id: string }).id)
  if (upErr) return NextResponse.json({ encontrado: true, error: 'No se pudo retomar el registro.' }, { status: 500 })

  await admin.from('vac_auditoria').insert({
    actor: uid, actor_tipo: 'CANDIDATO', accion: 'RECLAMAR_REGISTRO',
    entidad: 'candidatos', entidad_id: (cand as { id: string }).id,
    user_agent: req.headers.get('user-agent'),
  })

  return NextResponse.json({ encontrado: true, candidato: cand })
}
