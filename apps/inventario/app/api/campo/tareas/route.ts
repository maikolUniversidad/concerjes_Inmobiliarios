import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { sesionDeCampo } from '@/lib/campo/sesion'

export const runtime = 'nodejs'

/**
 * Qué tareas aplican en un punto, para la PWA de quien entró con enlace + PIN.
 *
 * Quien tiene cuenta llama `ronda_tareas_aplicables()` directo: la función
 * filtra por su alcance de contratos (`auth_ve_grupo`). Quien no tiene cuenta no
 * tiene `auth.uid()`, así que esa función le devolvería cero filas y vería un
 * punto sin tareas. Por eso F4 movió el cuerpo a `ronda_tareas_punto()`, que es
 * la MISMA consulta sin el filtro, y la llama aquí con la llave de servicio
 * después de comprobar que la sesión de campo es del contrato del punto.
 *
 * La autoridad, como en la ruta pública /q/<token>, es que el punto se resolvió
 * desde una placa firmada; aquí se le suma el PIN verificado.
 */
export async function GET(req: NextRequest) {
  const sesion = await sesionDeCampo()
  if (!sesion) {
    return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })
  }
  const punto = req.nextUrl.searchParams.get('punto') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(punto)) {
    return NextResponse.json({ error: 'Falta el punto.' }, { status: 400 })
  }
  const soloAhora = req.nextUrl.searchParams.get('ahora') === '1'

  const sb = getAdmin()
  const { data: p } = await sb
    .from('ronda_puntos')
    .select('id, grupo_id, estado')
    .eq('id', punto)
    .maybeSingle()
  const fila = p as { id: string; grupo_id: string; estado: string } | null
  if (!fila) return NextResponse.json({ error: 'El punto no existe.' }, { status: 404 })
  // Una sesión de campo vale para SU contrato y nada más. Si la sesión nació sin
  // contrato (se entró por el documento, sin escanear), se adopta el del punto
  // por el que está entrando ahora, que es el único alcance que puede tener.
  if (sesion.grupoId && sesion.grupoId !== fila.grupo_id) {
    return NextResponse.json({ error: 'Ese punto no es de tu contrato.' }, { status: 403 })
  }

  const { data, error } = await sb.rpc('ronda_tareas_punto', {
    p_punto: punto, p_solo_ahora: soloAhora,
  })
  if (error) {
    console.error('[campo/tareas]', error.message)
    return NextResponse.json({ error: 'No se pudieron leer las tareas.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, tareas: data ?? [] })
}
