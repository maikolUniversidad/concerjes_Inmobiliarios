import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { appSecret, verifyToken } from '@/lib/whatsapp/config'
import { resolverReto, verificarFirma, TOPE_CUERPO_BYTES, type MotivoRechazo } from '@/lib/whatsapp/firma'
import { encolarEventos } from '@/lib/whatsapp/motor'

export const runtime = 'nodejs'
// Diez segundos y no más: Meta reintenta si no recibe 200, y un reintento
// mientras todavía procesamos el primero genera trabajo duplicado. El objetivo
// real es por debajo de 300 ms.
export const maxDuration = 10
// Sin caché: cada POST es un evento distinto.
export const dynamic = 'force-dynamic'

/**
 * El webhook de WhatsApp. ES EL ÚNICO EXTREMO PÚBLICO DEL MÓDULO.
 *
 * Su autenticación es la FIRMA de Meta y nada más: no hay cookie, no hay token
 * de sesión, no hay IP de confianza, porque Meta no se puede autenticar de otra
 * forma. Por eso hay que excluir esta ruta del Firewall, de BotID y de
 * cualquier protección de despliegue de Vercel: si algo le pide una
 * credencial a Meta, Meta no entrega nada y el síntoma es «no llegan
 * mensajes», sin ningún error visible.
 *
 * TODO LO QUE LLEGA POR AQUÍ ES DATO HOSTIL, nunca instrucción. La firma dice
 * que el cuerpo lo armó quien tiene el app secret; no dice que su contenido sea
 * verdad. Nada de lo que llegue decide qué función se llama.
 *
 * EL POST HACE TRES COSAS Y RESPONDE: verificar la firma, insertar en
 * `whatsapp_eventos`, devolver 200. Nada de llamadas a Meta, nada de descargas,
 * nada de IA, nada de PDF. Todo eso es del trabajador de `/api/cron/whatsapp-entrada`.
 */

/** El reto de suscripción. Meta lo manda cada vez que se fija o se edita la
 *  Callback URL o el Verify token, y NO entrega ningún webhook hasta recibir un
 *  200 con el `hub.challenge` CRUDO, como texto plano. */
export async function GET(req: NextRequest) {
  const r = resolverReto(req.nextUrl.searchParams, verifyToken())
  if (!r.ok) {
    await registrarRechazo(req, r.motivo, 0)
    return new NextResponse('No autorizado', { status: 403 })
  }
  return new NextResponse(r.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function POST(req: NextRequest) {
  // 1. El cuerpo CRUDO, byte a byte. Se lee como texto y recién después se
  //    parsea: cualquier re-serialización cambia el hash (un `\/` escapado, el
  //    orden de las llaves) y la firma dejaría de cuadrar.
  let crudo: string
  try {
    crudo = await req.text()
  } catch {
    await registrarRechazo(req, 'CUERPO_INVALIDO', 0)
    return NextResponse.json({ error: 'Cuerpo ilegible' }, { status: 400 })
  }

  const bytes = Buffer.byteLength(crudo, 'utf8')
  // El cuerpo de Meta llega hasta 3 MB. Más que eso no puede ser suyo, y no
  // vale la pena gastar CPU firmándolo.
  if (bytes > TOPE_CUERPO_BYTES) {
    await registrarRechazo(req, 'CUERPO_GRANDE', bytes)
    return NextResponse.json({ error: 'Cuerpo demasiado grande' }, { status: 413 })
  }

  // 2. La firma, en tiempo constante.
  const v = verificarFirma(crudo, req.headers.get('x-hub-signature-256'), appSecret())
  if (!v.ok) {
    await registrarRechazo(req, v.motivo ?? 'FIRMA_INVALIDA', bytes)
    // 403 y NO se encola nada. Meta reintentará y seguirá recibiendo 403: eso
    // es lo correcto, no un problema.
    return NextResponse.json({ error: 'Firma inválida' }, { status: 403 })
  }

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    await registrarRechazo(req, 'CUERPO_INVALIDO', bytes)
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // 3. Guardar y responder.
  try {
    const sb = getAdmin()
    // La cuenta se resuelve en el trabajador, por `phone_number_id`: el webhook
    // no se gasta una consulta más en eso.
    const r = await encolarEventos(sb, cuerpo, null, esSimulado(req))
    // 200 con el detalle de qué se guardó y qué era repetido. Un repetido NO es
    // un error: es el reintento de Meta haciendo su trabajo.
    return NextResponse.json({ ok: true, ...r }, { status: 200 })
  } catch (e) {
    // 500 A PROPÓSITO para que Meta reintente (tiene 7 días). NUNCA 200 sobre un
    // evento que no quedó guardado: no hay API para recuperar un webhook viejo,
    // así que lo que no se guarde se pierde para siempre.
    console.error('[whatsapp/webhook]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo guardar el evento' }, { status: 500 })
  }
}

/** El simulador manda esta cabecera para que los eventos queden marcados. No
 *  cambia NADA de la verificación: el simulador firma con el app secret local y
 *  pasa por el mismo control que Meta. Si alguien la pusiera a mano sin firma
 *  válida, el 403 llega antes. */
function esSimulado(req: NextRequest): boolean {
  return req.headers.get('x-whatsapp-simulador') === '1'
}

async function registrarRechazo(req: NextRequest, motivo: MotivoRechazo, bytes: number) {
  try {
    // SIN el cuerpo: guardar el payload de algo que no se pudo autenticar es
    // guardar lo que un desconocido quiso meter en nuestra base.
    await getAdmin().from('whatsapp_eventos_rechazados').insert({
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      motivo,
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
      bytes,
      ruta: new URL(req.url).pathname.slice(0, 120),
    })
  } catch {
    // Que no se pueda registrar el rechazo no cambia la respuesta: el rechazo
    // ya ocurrió y es lo que importa.
  }
}
