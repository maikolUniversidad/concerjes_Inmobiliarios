import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { sesionDeCampo } from '@/lib/campo/sesion'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Subida de un medio al bucket `rondas` para quien entró con enlace + PIN.
 *
 * Quien tiene cuenta sube DIRECTO al bucket con las políticas de storage del
 * ADR-C (`ronda_evidencia_puede_subir`), que es lo que el ADR quiere: el
 * binario no pasa por la función serverless. Quien no tiene cuenta no puede:
 * sin `auth.uid()` ninguna política de storage lo deja, así que su archivo pasa
 * por aquí y sube con la llave de servicio.
 *
 * Consecuencia que hay que respetar en el cliente: el cuerpo de una función de
 * Vercel está limitado a 4,5 MB, así que la foto se comprime en el celular
 * antes de mandarla (es lo que hace `comprimirFoto()` en la PWA). Una foto de
 * ronda a 1.280 px de lado largo pesa entre 150 y 400 KB.
 */
export async function POST(req: NextRequest) {
  const sesion = await sesionDeCampo()
  if (!sesion) {
    return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })
  }

  const form = await req.formData()
  const archivo = form.get('archivo')
  const ruta = String(form.get('ruta') ?? '')
  if (!(archivo instanceof Blob)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 })
  }
  if (!ruta) {
    return NextResponse.json({ error: 'Falta la ruta destino.' }, { status: 400 })
  }

  // La carpeta tiene que ser la de una visita de ESTA persona. La llave de
  // servicio se salta la RLS, así que la comprobación que hace la política de
  // storage hay que hacerla aquí a mano.
  const visitaId = ruta.split('/')[0]
  if (!/^[0-9a-f-]{36}$/i.test(visitaId)) {
    return NextResponse.json({ error: 'Ruta inválida.' }, { status: 400 })
  }
  const sb = getAdmin()
  const { data: visita } = await sb
    .from('ronda_visitas')
    .select('id, persona_id, estado')
    .eq('id', visitaId)
    .maybeSingle()
  const v = visita as { id: string; persona_id: string; estado: string } | null
  if (!v || v.persona_id !== sesion.personaId) {
    return NextResponse.json({ error: 'Esa visita no es tuya.' }, { status: 403 })
  }
  if (['ANULADA', 'VENCIDA'].includes(v.estado)) {
    return NextResponse.json({ error: `La visita está ${v.estado}.` }, { status: 400 })
  }

  const { error } = await sb.storage.from('rondas').upload(ruta, archivo, {
    contentType: archivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (error && !/exists/i.test(error.message)) {
    console.error('[campo/medios] no se pudo subir', error.message)
    return NextResponse.json({ error: 'No se pudo subir el archivo.' }, { status: 500 })
  }
  // Un archivo que ya existía con la misma ruta es un reintento de la cola: el
  // nombre lleva el id de la evidencia, que lo genera el dispositivo, así que
  // es el MISMO archivo. No es un error.
  return NextResponse.json({ ok: true, ruta })
}

/**
 * URL firmada de 300 segundos para ver un medio (ADR-C: nunca pública, nunca
 * bucket público). La pantalla la vuelve a pedir si se queda abierta.
 */
export async function GET(req: NextRequest) {
  const sesion = await sesionDeCampo()
  if (!sesion) {
    return NextResponse.json({ error: 'Tu sesión de campo no está vigente.' }, { status: 401 })
  }
  const ruta = req.nextUrl.searchParams.get('ruta') ?? ''
  const visitaId = ruta.split('/')[0] === 'reportes' ? ruta.split('/')[1] : ruta.split('/')[0]
  if (!/^[0-9a-f-]{36}$/i.test(visitaId)) {
    return NextResponse.json({ error: 'Ruta inválida.' }, { status: 400 })
  }
  const sb = getAdmin()
  const { data: visita } = await sb
    .from('ronda_visitas').select('persona_id').eq('id', visitaId).maybeSingle()
  if ((visita as { persona_id?: string } | null)?.persona_id !== sesion.personaId) {
    return NextResponse.json({ error: 'Eso no es tuyo.' }, { status: 403 })
  }
  const { data, error } = await sb.storage.from('rondas').createSignedUrl(ruta, 300)
  if (error) return NextResponse.json({ error: 'No se pudo firmar la URL.' }, { status: 500 })
  return NextResponse.json({ ok: true, url: data?.signedUrl })
}
