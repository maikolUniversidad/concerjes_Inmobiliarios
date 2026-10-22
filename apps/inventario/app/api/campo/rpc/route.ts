import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { sesionDeCampo } from '@/lib/campo/sesion'

export const runtime = 'nodejs'

/**
 * Puente de escritura para la PWA de quien entró con enlace + PIN.
 *
 * Quien tiene cuenta NO pasa por aquí: llama las RPC directo con su sesión de
 * Supabase y la RLS lo filtra. Quien no tiene cuenta no tiene `auth.uid()`, así
 * que la única forma de que sus escrituras pasen por las MISMAS RPC —que es lo
 * que garantiza que la geocerca, el motivo obligatorio y los mínimos de foto se
 * validen igual en los tres canales (ADR-E)— es llamarlas desde el servidor con
 * la llave de servicio, después de comprobar la cookie firmada.
 *
 * Tres candados, porque la llave de servicio se salta la RLS:
 *   1. solo las funciones de la lista blanca;
 *   2. `p_persona` y `p_sesion` los pone el SERVIDOR desde la cookie. Lo que
 *      mande el cliente en esos dos campos se ignora: si no, cualquiera con
 *      una sesión válida escribiría a nombre de otra persona;
 *   3. el resto de los argumentos tienen que ser escalares o JSON plano.
 */
const PERMITIDAS = new Set([
  'ronda_registrar_visita',
  'ronda_responder_paso',
  'ronda_adjuntar_evidencia',
  'ronda_firmar',
  'ronda_cerrar_visita',
  'ronda_reportar_novedad',
  'ronda_validar_cierre',
  'persona_consentimiento_registrar',
])

export async function POST(req: NextRequest) {
  const sesion = await sesionDeCampo()
  if (!sesion) {
    return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })
  }

  let cuerpo: { fn?: string; args?: Record<string, unknown> }
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }
  const fn = (cuerpo.fn ?? '').trim()
  if (!PERMITIDAS.has(fn)) {
    return NextResponse.json({ error: `Función no permitida: ${fn}` }, { status: 400 })
  }

  const args: Record<string, unknown> = { ...(cuerpo.args ?? {}) }
  // El actor lo pone el servidor, siempre.
  delete args.p_persona
  delete args.p_sesion
  if (fn === 'persona_consentimiento_registrar') {
    args.p_persona = sesion.personaId
    args.p_sesion = sesion.sesionId
  } else if (fn !== 'ronda_validar_cierre') {
    args.p_persona = sesion.personaId
    args.p_sesion = sesion.sesionId
  }

  const { data, error } = await getAdmin().rpc(fn, args)
  if (error) {
    // El mensaje de la RPC es para la persona que está trabajando («estás a
    // 120 m del punto…»), así que se devuelve tal cual. Las RPC de esta fase
    // están escritas para eso y no filtran nada que la persona no sepa ya.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, data })
}
