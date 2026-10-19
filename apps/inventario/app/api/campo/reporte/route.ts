import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sesionDeCampo } from '@/lib/campo/sesion'
import { generarReporteVisita } from '@/lib/campo/reporte'
import { llamarRpc } from '@/lib/campo/rpc'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Genera el PDF de una visita cerrada y lo registra con su sha256.
 *
 * Lo puede pedir quien hizo la visita (desde la PWA, al terminar) y quien la
 * puede ver desde la consola. La comprobación es la misma en los dos casos: que
 * la visita sea de esta persona, o que quien pide tenga alcance sobre ella —y
 * eso lo responde la base con `ronda_visita_puede_ver()`, no esta función.
 *
 * Si el PDF se pide y no se puede armar (una foto corrupta, el bucket caído),
 * la visita YA está cerrada: el reporte se puede volver a pedir, y nada de lo
 * que hizo el trabajador se pierde por eso.
 */
export async function POST(req: NextRequest) {
  let cuerpo: { visita?: string }
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }
  const visitaId = (cuerpo.visita ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(visitaId)) {
    return NextResponse.json({ error: 'Falta la visita.' }, { status: 400 })
  }

  const sesion = await sesionDeCampo()
  let autorizado = false

  if (sesion) {
    const { data } = await getAdmin()
      .from('ronda_visitas').select('persona_id').eq('id', visitaId).maybeSingle()
    autorizado = (data as { persona_id?: string } | null)?.persona_id === sesion.personaId
  } else {
    // Con cuenta: se le pregunta a la base, que es la que sabe del alcance.
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      autorizado = await llamarRpc<boolean>(sb, 'ronda_visita_puede_ver', { p_visita: visitaId })
        .catch(() => false) === true
    }
  }
  if (!autorizado) {
    return NextResponse.json({ error: 'No puedes generar el reporte de esa visita.' }, { status: 403 })
  }

  try {
    const r = await generarReporteVisita(visitaId)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'No se pudo generar el reporte.'
    console.error('[campo/reporte]', mensaje)
    return NextResponse.json({ error: mensaje }, { status: 400 })
  }
}
