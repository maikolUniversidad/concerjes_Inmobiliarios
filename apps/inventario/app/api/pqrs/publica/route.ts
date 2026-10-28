import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { ipDeSolicitud } from '@/lib/campo/peticion'
import { normalizar } from '@/lib/puntos-qr'
import { ipHashDeSolicitud } from '@/lib/pqrs/ip-hash'
import {
  MAX_FOTOS_PUBLICAS, problemaDeFoto, type CalidadPublica, CALIDADES_PUBLICAS,
} from '@/lib/pqrs/publico'
import { resolverCodigo, TEXTO_RECHAZO } from '@/app/q/decidir'
import { puertaSupabase } from '@/app/q/puerta-supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Radicación PÚBLICA de una PQRS desde el QR de un punto (F5 de Puntos QR).
 *
 * Es la única puerta de escritura sin sesión del módulo de PQRS, y hace tres
 * cosas que ni el navegador ni la base pueden hacer solos:
 *
 *   1. verifica la FIRMA del token con la misma `resolverCodigo()` de F2 —la
 *      llave vive en variables de entorno del servidor (ADR-B), no en la base—,
 *      lo que además deja el evento de auditoría de cada rechazo;
 *   2. calcula el `ip_hash` con la sal del despliegue. El navegador NO lo
 *      manda: si lo mandara, saltarse el límite por hora sería editar un campo
 *      del formulario;
 *   3. sube la foto con la llave de servicio, porque sin `auth.uid()` ninguna
 *      política del bucket `pqrs` deja subir nada (igual que /api/campo/medios).
 *
 * Después llama a `pqrs_radicar_publica()`, que vuelve a validar TODO lo que se
 * puede validar sin la llave de firma: estado del QR, vigencia del contrato,
 * estado del punto, `grupo_reglas.pqrs_publico`, la categoría y los dos topes
 * por hora. Defensa en profundidad: si esta ruta se equivoca, la base no.
 */
export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el formulario.' }, { status: 400 })
  }

  const texto = (k: string) => String(form.get(k) ?? '').trim()
  const codigo = texto('codigo')
  const categoria = texto('categoria')
  const descripcion = texto('descripcion')
  const anonima = texto('anonima') !== 'no'
  const nombre = texto('nombre')
  const calidadCruda = texto('calidad').toUpperCase()
  const calidad: CalidadPublica =
    (CALIDADES_PUBLICAS as readonly string[]).includes(calidadCruda)
      ? (calidadCruda as CalidadPublica)
      : 'RESIDENTE'

  if (!codigo) return NextResponse.json({ error: 'Falta el código del punto.' }, { status: 400 })
  // La categoría viaja como UUID: si no lo es, se dice en español en vez de
  // dejar que la base conteste «invalid input syntax for type uuid».
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoria)) {
    return NextResponse.json({ error: 'Dinos de qué se trata.' }, { status: 400 })
  }
  if (descripcion.length < 10) {
    return NextResponse.json({ error: 'Cuéntanos un poco más de lo que pasó.' }, { status: 400 })
  }
  // Tope de texto: esta ruta es pública y no hay nada que impida mandar un
  // megabyte de letras. El formulario ya corta en 2.000.
  if (descripcion.length > 4000) {
    return NextResponse.json({ error: 'El reporte es demasiado largo. Cuéntanoslo más corto.' }, { status: 400 })
  }

  // ── 1. El código, con su firma ──────────────────────────────────────────────
  const ip = ipDeSolicitud(req)
  let r
  try {
    r = await resolverCodigo(codigo, ip, puertaSupabase())
  } catch (e) {
    // La base no contestó (el corte de 8 s de Supabase, por ejemplo). Es un
    // problema nuestro, no del reporte: se dice así y se puede reintentar.
    console.error('[pqrs/publica] no se pudo resolver el código', e)
    return NextResponse.json(
      { error: 'No pudimos conectar en este momento. Vuelve a intentarlo en un momento.' },
      { status: 503 })
  }
  if (!r.ok) {
    return NextResponse.json({ error: TEXTO_RECHAZO[r.motivo].titulo, motivo: r.motivo }, { status: 400 })
  }

  const sb = getAdmin()

  // ── 2. El cupo, ANTES de subir fotos ───────────────────────────────────────
  // Que la base lo vuelva a mirar al escribir no sobra, pero preguntar aquí
  // primero evita subir un par de fotos que van a quedar huérfanas.
  const ipHash = ipHashDeSolicitud(ip)
  const { data: cupo } = await sb.rpc('pqrs_publica_cupo', {
    p_ip_hash: ipHash, p_punto: r.punto.id,
  })
  const c = Array.isArray(cupo) ? cupo[0] : cupo
  if (c && c.por_origen >= c.tope_origen) {
    return NextResponse.json(
      { error: 'Ya enviaste varios reportes en la última hora. Espera un momento antes de enviar otro.' },
      { status: 429 })
  }
  if (c && c.por_punto >= c.tope_punto) {
    return NextResponse.json(
      { error: 'Este punto ya tiene varios reportes en la última hora; el equipo está en eso.' },
      { status: 429 })
  }

  // ── 3. Las fotos ───────────────────────────────────────────────────────────
  // El id de la PQRS se genera aquí para poder subir a `pqrs/{id}/…` antes de
  // que la fila exista, igual que hace el formulario de la consola.
  const id = crypto.randomUUID()
  const fotos = form.getAll('fotos').filter((f): f is File => f instanceof File).slice(0, MAX_FOTOS_PUBLICAS)
  const adjuntos: { path: string; nombre: string; mime: string; bytes: number }[] = []
  for (const f of fotos) {
    const problema = problemaDeFoto(f.name || 'foto', f.size, f.type || '')
    if (problema) return NextResponse.json({ error: problema }, { status: 400 })
    const ext = (f.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
    const path = `${id}/${crypto.randomUUID()}.${ext}`
    const { error } = await sb.storage.from('pqrs').upload(path, f, {
      contentType: f.type || 'image/jpeg', upsert: false,
    })
    if (error) {
      console.error('[pqrs/publica] no se pudo subir la foto', error.message)
      await limpiar(sb, adjuntos.map((a) => a.path))
      return NextResponse.json({ error: 'No se pudo subir la foto. Intenta enviar el reporte sin ella.' }, { status: 500 })
    }
    adjuntos.push({ path, nombre: (f.name || 'foto.jpg').slice(0, 255), mime: f.type || 'image/jpeg', bytes: f.size })
  }

  // ── 4. A radicar ───────────────────────────────────────────────────────────
  const { data, error } = await sb.rpc('pqrs_radicar_publica', {
    // NORMALIZADO, no lo que vino en la URL: el código impreso se lee «7PP6-WNGB»
    // y la base guarda `7PP6WNGB`. `resolverCodigo()` ya normaliza para buscar,
    // así que aquí se hace lo mismo o la RPC no encontraría la placa que la
    // página sí abrió.
    p_codigo: normalizar(codigo),
    p_categoria: categoria,
    p_asunto: null,
    p_descripcion: descripcion,
    p_anonima: anonima,
    p_solicitante: anonima
      ? { telefono: texto('telefono') || null, email: texto('email') || null }
      : {
          nombre, calidad,
          telefono: texto('telefono') || null,
          email: texto('email') || null,
        },
    p_ip_hash: ipHash,
    p_modo: r.aperturaModo,
    p_adjuntos: adjuntos,
    p_id: id,
  })

  if (error) {
    await limpiar(sb, adjuntos.map((a) => a.path))
    // El mensaje de la RPC está escrito PARA el residente («este punto ya tiene
    // varios reportes…»), así que se devuelve tal cual. Ninguno revela nada que
    // quien tiene la placa enfrente no sepa ya.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const fila = (Array.isArray(data) ? data[0] : data) as { numero: string; fecha_limite: string } | null
  return NextResponse.json({
    ok: true,
    numero: fila?.numero ?? '',
    fecha_limite: fila?.fecha_limite ?? '',
  })
}

/** Borra las fotos que se subieron para una PQRS que al final no se radicó. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function limpiar(sb: any, rutas: string[]) {
  if (rutas.length === 0) return
  try {
    await sb.storage.from('pqrs').remove(rutas)
  } catch (e) {
    console.error('[pqrs/publica] quedaron fotos sin PQRS', rutas, e)
  }
}
