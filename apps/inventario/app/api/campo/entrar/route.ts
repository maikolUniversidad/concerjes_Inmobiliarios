import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { ipDeSolicitud } from '@/lib/campo/peticion'

export const runtime = 'nodejs'

/**
 * Pide el enlace de un uso + PIN para quien NO tiene cuenta (ADR-A, §1.2).
 *
 * Qué NO devuelve: el token ni el PIN. Van al canal VERIFICADO de la persona y
 * el navegador que los pide no los ve — si los devolviera, cualquiera con un
 * documento ajeno entraría, y el canal verificado dejaría de significar algo.
 *
 * Qué devuelve: si hay por dónde mandarlo y a dónde se mandó, enmascarado
 * («***4321»), que es lo que la pantalla necesita para decir «revisa tu
 * WhatsApp» sin revelar el número completo a quien escribió el documento.
 *
 * Límite conocido: el transporte de WhatsApp y SMS es de F9. Mientras no
 * exista, `ronda_acceso_solicitar()` deja la solicitud en SIN_CANAL y el PIN se
 * entrega desde la consola (`gestionar_accesos_campo`). Se dice en la respuesta
 * en vez de fingir que se envió.
 */
export async function POST(req: NextRequest) {
  let cuerpo: { documento?: string; canal?: string; punto?: string; destino?: string }
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const documento = (cuerpo.documento ?? '').trim()
  if (!/^[0-9A-Za-z-]{4,30}$/.test(documento)) {
    return NextResponse.json({ error: 'Escribe tu número de documento.' }, { status: 400 })
  }

  const sb = getAdmin()
  const { data, error } = await sb.rpc('ronda_acceso_solicitar', {
    p_documento: documento,
    p_canal: (cuerpo.canal ?? 'WHATSAPP').toUpperCase(),
    p_punto: cuerpo.punto ?? null,
    p_destino: cuerpo.destino ?? null,
    p_ip: ipDeSolicitud(req),
  })
  if (error) {
    console.error('[campo/entrar] no se pudo crear el acceso', error.message)
    return NextResponse.json({ error: 'No se pudo generar el acceso.' }, { status: 500 })
  }

  const r = (data ?? {}) as {
    ok?: boolean; motivo?: string; sesion_id?: string; token?: string; pin?: string
    canal?: string; entrega?: string; persona_nombre?: string; tiene_cuenta?: boolean
  }

  // La respuesta es la MISMA para «el documento no existe» y «no tiene canal
  // verificado»: si fueran distintas, esta pantalla sería un verificador de
  // cédulas de 6.564 personas.
  if (!r.ok) {
    if (r.motivo === 'DEMASIADOS_INTENTOS') {
      return NextResponse.json({
        ok: false,
        mensaje: 'Ya se pidieron varios accesos hace poco. Espera unos minutos o pídele el PIN a tu supervisor.',
      })
    }
    return NextResponse.json({
      ok: false,
      mensaje: 'No se pudo mandar el enlace. Pídele a tu supervisor que te dé el acceso.',
    })
  }

  const base = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '')
  const enlace = `${base}/campo/entrar?t=${r.token}`

  if (r.entrega === 'ENVIADO' && r.canal === 'CORREO') {
    // El correo sale por el buzón que ya existe (`correo_saliente`, procesado
    // por /api/cron/correo). Es el único canal con transporte hoy.
    const { error: errCorreo } = await sb.from('correo_saliente').insert({
      para: await destinoDeSesion(r.sesion_id!),
      asunto: 'Tu acceso para la ronda',
      cuerpo_texto:
        `Hola${r.persona_nombre ? ' ' + r.persona_nombre : ''}.\n\n`
        + `Entra con este enlace: ${enlace}\n`
        + `Tu PIN es ${r.pin}. Vence en 15 minutos y sirve una sola vez.\n\n`
        + 'Si no pediste este acceso, avísale a tu supervisor.',
      origen: 'ronda_acceso',
      ref_id: r.sesion_id,
    })
    if (errCorreo) {
      console.error('[campo/entrar] no se pudo encolar el correo', errCorreo.message)
      await sb.from('ronda_sesiones')
        .update({ entrega_estado: 'FALLIDO', entrega_detalle: errCorreo.message })
        .eq('id', r.sesion_id!)
      return NextResponse.json({
        ok: false, mensaje: 'No se pudo mandar el correo. Pídele el PIN a tu supervisor.',
      })
    }
  }

  const { data: fila } = await sb.from('ronda_sesiones')
    .select('destino_enmascarado, canal, entrega_estado')
    .eq('id', r.sesion_id!).maybeSingle()
  const s = (fila ?? {}) as {
    destino_enmascarado?: string | null; canal?: string; entrega_estado?: string
  }

  return NextResponse.json({
    ok: true,
    canal: s.canal ?? r.canal,
    entrega: s.entrega_estado ?? r.entrega,
    destino: s.destino_enmascarado ?? null,
    tieneCuenta: r.tiene_cuenta === true,
    mensaje: s.entrega_estado === 'ENVIADO'
      ? `Te mandamos el enlace y el PIN a ${s.destino_enmascarado ?? 'tu canal verificado'}.`
      : 'Tu acceso quedó listo, pero todavía no se puede enviar solo: pídele el PIN a tu supervisor.',
  })
}

/** Dirección de correo del canal de la sesión. Se lee aquí y no se devuelve al
 *  navegador: el buzón necesita la dirección completa, la pantalla no. */
async function destinoDeSesion(sesionId: string): Promise<string> {
  const { data } = await getAdmin()
    .from('ronda_sesiones')
    .select('canal_id, persona_canales!inner(valor)')
    .eq('id', sesionId)
    .maybeSingle()
  const d = data as { persona_canales?: { valor?: string } } | null
  return d?.persona_canales?.valor ?? ''
}
