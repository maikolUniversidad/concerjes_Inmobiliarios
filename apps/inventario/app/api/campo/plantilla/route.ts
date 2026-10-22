import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { sesionDeCampo } from '@/lib/campo/sesion'

export const runtime = 'nodejs'

/**
 * Los pasos de una plantilla publicada, para la PWA de quien entró con enlace +
 * PIN (quien tiene cuenta los lee con su sesión y la RLS del catálogo).
 *
 * Solo plantillas PUBLICADAS: un borrador no se ejecuta, y dárselo al celular
 * sería dejar trabajar con una versión que todavía se está editando. También va
 * el instructivo de cada paso, porque es lo que se mira ANTES de hacer la
 * tarea y tiene que estar en el celular antes de bajar al sótano.
 */
export async function GET(req: NextRequest) {
  const sesion = await sesionDeCampo()
  if (!sesion) {
    return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Falta la plantilla.' }, { status: 400 })
  }

  const sb = getAdmin()
  const { data: plantilla } = await sb
    .from('ronda_plantillas')
    .select('id, codigo, version, nombre, estado, grupo_id, exige_firma, exige_geocerca')
    .eq('id', id)
    .maybeSingle()
  const pl = plantilla as {
    id: string; codigo: string; version: number; nombre: string; estado: string
    grupo_id: string | null; exige_firma: boolean; exige_geocerca: boolean
  } | null
  if (!pl) return NextResponse.json({ error: 'La plantilla no existe.' }, { status: 404 })
  if (pl.estado !== 'PUBLICADA') {
    return NextResponse.json({ error: 'Esa versión de la tarea no está publicada.' }, { status: 400 })
  }
  // Una plantilla de contrato solo la ve quien está en ese contrato; las
  // generales (grupo_id NULL) las ve cualquier sesión de campo.
  if (pl.grupo_id && sesion.grupoId && pl.grupo_id !== sesion.grupoId) {
    return NextResponse.json({ error: 'Esa tarea no es de tu contrato.' }, { status: 403 })
  }

  const { data: pasos } = await sb
    .from('ronda_plantilla_pasos')
    .select('*')
    .eq('plantilla_id', id)
    .order('orden')

  const ids = [...new Set(((pasos ?? []) as { instructivo_id: string | null }[])
    .map((p) => p.instructivo_id).filter(Boolean) as string[])]
  let instructivos: unknown[] = []
  if (ids.length > 0) {
    const { data } = await sb
      .from('ronda_instructivos')
      .select('id, titulo, tipo, momento, texto, archivo_path, duracion_seg')
      .in('id', ids)
    instructivos = data ?? []
  }

  return NextResponse.json({ ok: true, plantilla: pl, pasos: pasos ?? [], instructivos })
}
