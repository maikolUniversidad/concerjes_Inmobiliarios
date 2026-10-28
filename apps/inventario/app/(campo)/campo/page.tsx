import { redirect } from 'next/navigation'
import { actorDeCampo } from '@/lib/campo/sesion'
import { getAdmin } from '@/lib/supabase/admin'
import { CONSENTIMIENTOS, NECESARIOS } from '@/lib/campo/consentimientos'
import { InicioCampo } from '@/components/campo/InicioCampo'
import type { ProximaParada, TurnoAbierto } from '@/components/campo/TurnoYUbicacion'

// Pantalla de inicio de la PWA: escanear el QR o escribir el código impreso.
//
// Es el punto de entrada cuando la app ya está instalada. Quien llega por la
// placa entra por /q/<token>, que resuelve y verifica la firma (F2) y manda
// aquí o directo al punto.
export const dynamic = 'force-dynamic'

export default async function InicioCampoPage() {
  const actor = await actorDeCampo()
  if (!actor) redirect('/campo/entrar?destino=/campo')

  // Qué consentimientos faltan. Los necesarios se piden ANTES del primer uso;
  // la biometría se ofrece y se puede decir que no sin consecuencias.
  const sb = getAdmin()
  const { data } = await sb
    .from('persona_consentimientos')
    .select('tipo, otorgado, texto_version, revocado_at, created_at')
    .eq('persona_id', actor.personaId)
    .order('created_at', { ascending: false })

  const ultimo = new Map<string, { otorgado: boolean; version: string; revocado: boolean }>()
  for (const c of (data ?? []) as {
    tipo: string; otorgado: boolean; texto_version: string; revocado_at: string | null
  }[]) {
    if (!ultimo.has(c.tipo)) {
      ultimo.set(c.tipo, {
        otorgado: c.otorgado, version: c.texto_version, revocado: c.revocado_at != null,
      })
    }
  }
  const faltan = CONSENTIMIENTOS.filter((c) => {
    const u = ultimo.get(c.tipo)
    // Falta si nunca se preguntó, o si el texto cambió de versión (hay que
    // volver a preguntar: lo que aceptó ya no es lo que dice el texto de hoy).
    return !u || u.version !== c.version
  }).map((c) => c.tipo)

  const bloqueantes = faltan.filter((t) => NECESARIOS.includes(t))

  // ── El turno y la ubicación (F8) ──────────────────────────────────────────
  // El consentimiento de SEGUIMIENTO se resuelve AQUÍ, en el servidor: sin él,
  // la pantalla ni le pide el GPS al navegador. La base lo rechazaría igual
  // (R1 vive ahí), pero pedirle la ubicación a quien dijo que no sobra.
  const ultimoSeg = ultimo.get('SEGUIMIENTO')
  const consienteSeguimiento = !!ultimoSeg && ultimoSeg.otorgado && !ultimoSeg.revocado

  // Los tipos generados no conocen las funciones nuevas (mismo motivo que
  // `lib/campo/rpc.ts`): el casteo vive en una constante con nombre.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbx = sb as any

  const { data: turnoId } = await sbx.rpc('ronda_turno_abierto', { p_persona: actor.personaId })
  let turno: TurnoAbierto | null = null
  let parada: ProximaParada | null = null
  let seguimientoHabilitado = false
  let intervaloSeg = 120
  if (turnoId) {
    const { data: t } = await sbx.from('ronda_turnos')
      .select('id, grupo_id, sede_id, inicio_at, fin_previsto_at, puntos_registrados, metros_recorridos, ultima_posicion_at')
      .eq('id', turnoId).maybeSingle()
    turno = (t ?? null) as TurnoAbierto | null
    const { data: p } = await sbx.rpc('ronda_proxima_parada', { p_persona: actor.personaId })
    parada = (p ?? null) as ProximaParada | null
    if (turno?.grupo_id) {
      const { data: reglas } = await sbx.from('grupo_reglas')
        .select('comparte_seguimiento_vivo, ubicacion_intervalo_seg')
        .eq('grupo_id', turno.grupo_id).maybeSingle()
      seguimientoHabilitado = reglas?.comparte_seguimiento_vivo === true
      intervaloSeg = Number(reglas?.ubicacion_intervalo_seg ?? 120)
    }
  }

  // Dónde puede abrir turno: las sedes de SU contrato. Una sesión de campo
  // tiene uno solo (el de la placa que escaneó), así que la lista es corta.
  let sedesTurno: { id: string; nombre: string }[] = []
  if (!turno) {
    let q = sbx.from('sedes').select('id, nombre').order('nombre').limit(50)
    if (actor.grupoId) q = q.eq('grupo_id', actor.grupoId)
    const { data: s } = await q
    sedesTurno = (s ?? []) as { id: string; nombre: string }[]
  }

  return (
    <InicioCampo
      actor={{
        personaId: actor.personaId,
        nombre: actor.personaNombre,
        modo: actor.metodo === 'CUENTA' ? 'cuenta' : 'sesion',
        sesionId: actor.sesionId,
      }}
      faltanConsentimientos={faltan}
      bloqueantes={bloqueantes}
      turno={turno}
      parada={parada}
      sedesTurno={sedesTurno}
      consienteSeguimiento={consienteSeguimiento}
      seguimientoHabilitado={seguimientoHabilitado}
      intervaloSeg={intervaloSeg}
    />
  )
}
