import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { actorDeCampo } from '@/lib/campo/sesion'

export const runtime = 'nodejs'

/**
 * El turno y la ubicación de la PWA de campo (F8).
 *
 * Tres operaciones, un solo sitio:
 *   GET    → el turno abierto de la persona, su ruta y su próxima parada.
 *   POST   → abrir o cerrar el turno (`{accion: 'abrir'|'cerrar'}`).
 *   PUT    → mandar una posición.
 *
 * Va aparte de /api/campo/rpc a propósito. Esa ruta es un puente genérico que
 * solo acepta a quien entró con enlace + PIN; aquí entran los DOS caminos
 * (cuenta y sesión de campo), porque la ubicación la manda cualquiera que esté
 * trabajando, y porque la respuesta de un rechazo tiene que ser un 403 con su
 * motivo y no un 400 genérico.
 *
 * R1 NO se comprueba aquí: lo comprueba `ronda_registrar_ubicacion()` en la
 * base. Esta ruta solo traduce su respuesta a un código HTTP. Si la regla
 * viviera aquí, se podría esquivar llamando la RPC por otro camino — y ese es
 * justo el error que §4.3 prohíbe («no es una regla de interfaz»).
 */

interface Actor { personaId: string; sesionId: string | null }

async function actor(): Promise<Actor | null> {
  const a = await actorDeCampo()
  if (!a) return null
  return { personaId: a.personaId, sesionId: a.sesionId }
}

export async function GET() {
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })

  const sb = getAdmin()
  const { data: turnoId, error } = await sb.rpc('ronda_turno_abierto', { p_persona: a.personaId })
  if (error) {
    console.error('[campo/turno GET]', error.message)
    return NextResponse.json({ error: 'No se pudo leer tu turno.' }, { status: 500 })
  }
  if (!turnoId) return NextResponse.json({ ok: true, turno: null, parada: null })

  const [{ data: turno }, { data: parada }] = await Promise.all([
    sb.from('ronda_turnos')
      .select('id, grupo_id, sede_id, inicio_at, fin_previsto_at, puntos_registrados, metros_recorridos, ultima_posicion_at')
      .eq('id', turnoId as string).maybeSingle(),
    sb.rpc('ronda_proxima_parada', { p_persona: a.personaId }),
  ])

  // ¿El contrato del turno permite el seguimiento? La persona tiene derecho a
  // saber si lo que está compartiendo se está guardando o no (el indicador
  // visible que pide §10.3 tiene que decir la verdad).
  const grupo = (turno as { grupo_id?: string } | null)?.grupo_id
  let seguimiento = false
  let intervaloSeg = 120
  if (grupo) {
    const { data: reglas } = await sb.from('grupo_reglas')
      .select('comparte_seguimiento_vivo, ubicacion_intervalo_seg')
      .eq('grupo_id', grupo).maybeSingle()
    const r = reglas as { comparte_seguimiento_vivo?: boolean; ubicacion_intervalo_seg?: number } | null
    seguimiento = r?.comparte_seguimiento_vivo === true
    intervaloSeg = r?.ubicacion_intervalo_seg ?? 120
  }

  return NextResponse.json({
    ok: true, turno, parada, seguimientoHabilitado: seguimiento, intervaloSeg,
  })
}

export async function POST(req: NextRequest) {
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })

  let cuerpo: { accion?: string; sede?: string }
  try { cuerpo = await req.json() } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const sb = getAdmin()
  if (cuerpo.accion === 'cerrar') {
    const { data, error } = await sb.rpc('ronda_turno_cerrar', {
      p_turno: null, p_persona: a.personaId, p_sesion: a.sesionId,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, turno: data })
  }

  if (cuerpo.accion !== 'abrir') {
    return NextResponse.json({ error: 'Acción no reconocida.' }, { status: 400 })
  }
  if (!cuerpo.sede || !/^[0-9a-f-]{36}$/i.test(cuerpo.sede)) {
    return NextResponse.json({ error: 'Falta la sede del turno.' }, { status: 400 })
  }
  const { data, error } = await sb.rpc('ronda_turno_abrir', {
    p_sede: cuerpo.sede, p_fin_previsto: null, p_puesto: null, p_patron: null,
    p_origen: 'APP', p_observacion: null,
    p_persona: a.personaId, p_sesion: a.sesionId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, turno: data })
}

export async function PUT(req: NextRequest) {
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })

  let cuerpo: {
    lat?: number; lng?: number; precision?: number | null
    velocidad?: number | null; rumbo?: number | null
    fuente?: string; capturado?: string | null
    visita?: string | null; punto?: string | null
  }
  try { cuerpo = await req.json() } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }
  if (typeof cuerpo.lat !== 'number' || typeof cuerpo.lng !== 'number') {
    return NextResponse.json({ error: 'Falta la coordenada.' }, { status: 400 })
  }

  const sb = getAdmin()
  const { data, error } = await sb.rpc('ronda_registrar_ubicacion', {
    p_lat: cuerpo.lat,
    p_lng: cuerpo.lng,
    p_precision: cuerpo.precision ?? null,
    p_velocidad: cuerpo.velocidad ?? null,
    p_rumbo: cuerpo.rumbo ?? null,
    // La PWA solo puede reportar con la pantalla abierta: el segundo plano es
    // de la app nativa (§1.1), así que `APP_NATIVA` no se emite desde aquí.
    p_fuente: cuerpo.fuente === 'ESCANEO' ? 'ESCANEO' : 'APP_VIVO',
    p_capturado: cuerpo.capturado ?? null,
    p_visita: cuerpo.visita ?? null,
    p_punto: cuerpo.punto ?? null,
    p_persona: a.personaId,
    p_sesion: a.sesionId,
  })
  if (error) {
    // Una excepción de la RPC aquí es un error de programa (coordenada
    // inválida, fuente desconocida): los rechazos de R1 NO lanzan, vienen
    // abajo como `estado: 'RECHAZADA'`.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const r = (data ?? {}) as { estado?: string; motivo?: string; mensaje?: string }
  if (r.estado === 'RECHAZADA') {
    // 403 y no 400: no es que el cuerpo esté mal, es que no está permitido
    // registrar esa ubicación. El cliente apaga el reporte al verlo.
    return NextResponse.json(
      { ok: false, estado: 'RECHAZADA', motivo: r.motivo, error: r.mensaje },
      { status: 403 },
    )
  }
  return NextResponse.json({ ok: true, ...r })
}
