import 'server-only'

// Descarga de medios: fotos, audios, videos y documentos que llegan por el chat.
//
// EL RELOJ CORRE Y CORRE RÁPIDO:
//   · la URL que devuelve `GET /{MEDIA_ID}` vale CINCO MINUTOS;
//   · el `media_id` que llega por webhook expira a los SIETE DÍAS;
//   · pasado eso no hay segunda oportunidad y no hay API para recuperarlo.
// La foto de un trabajo hecho es la prueba de que se hizo, así que se baja de
// inmediato y se guarda en Storage propio. Lo que vive en Meta es temporal.
//
// NI LA CONSOLA NI EL PDF REFERENCIAN NUNCA LA URL DE META: se sirven URLs
// firmadas de corta duración desde nuestro bucket, como ya hacen
// `gestion-humana/documentos` y el expediente de postulaciones.

import { createHash } from 'node:crypto'
import { clienteDe, SinCredencial, type CuentaTransporte } from './cliente'
import { config, simuladorActivo } from './config'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any

export interface MedioEntrante {
  conversacionId: string
  cuentaId: string
  mensajeWamid: string | null
  mediaId: string
  mime: string | null
  sha256Declarado: string | null
  hito: string
  comoDocumento: boolean
  voz: boolean
  visitaId: string | null
  tareaId: string | null
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
}

function extensionDe(mime: string | null, nombre: string | null): string {
  const limpio = (mime ?? '').split(';')[0].trim().toLowerCase()
  if (EXT[limpio]) return EXT[limpio]
  const m = (nombre ?? '').match(/\.([A-Za-z0-9]{1,6})$/)
  return m ? m[1].toLowerCase() : 'bin'
}

/** Encola el medio y, si se puede, lo baja enseguida. Si la descarga falla, la
 *  fila queda PENDIENTE con su retroceso: la visita NO se bloquea. */
export async function descargarMedio(supabase: Sb, m: MedioEntrante): Promise<void> {
  // El medio se cuelga del mensaje entrante, por wamid.
  let mensajeId: string | null = null
  if (m.mensajeWamid) {
    const { data } = await supabase.from('crm_mensajes').select('id').eq('wamid', m.mensajeWamid).maybeSingle()
    mensajeId = data?.id ?? null
  }
  if (!mensajeId) {
    // Sin el mensaje no hay de dónde colgar el medio. Se deja el rastro y se
    // sale: perder el archivo es grave, pero inventar una fila huérfana que
    // nadie va a mirar es peor.
    await supabase.from('ronda_eventos').insert({
      entidad: 'crm_conversaciones',
      entidad_id: m.conversacionId,
      accion: 'MEDIO_SIN_MENSAJE',
      actor_tipo: 'BOT',
      canal: 'WHATSAPP',
      detalle: { media_id: m.mediaId, hito: m.hito },
    })
    return
  }

  // `ux_whatsapp_medios_mensaje` hace esto idempotente: un reintento del evento
  // no baja el archivo dos veces.
  const { data: fila } = await supabase
    .from('whatsapp_medios')
    .upsert(
      {
        mensaje_id: mensajeId,
        conversacion_id: m.conversacionId,
        wamid: m.mensajeWamid,
        media_id: m.mediaId,
        hito: m.hito,
        mime: m.mime,
        sha256_declarado: m.sha256Declarado,
        con_exif: m.comoDocumento,
        voz: m.voz,
        visita_id: m.visitaId,
        estado: 'PENDIENTE',
      },
      { onConflict: 'mensaje_id', ignoreDuplicates: true },
    )
    .select('id, estado')
    .maybeSingle()

  const medioId: string | null =
    fila?.id ??
    (await supabase.from('whatsapp_medios').select('id, estado').eq('mensaje_id', mensajeId).maybeSingle())
      .data?.id ??
    null
  if (!medioId) return

  await bajarUno(supabase, medioId)
}

/** Baja un medio que está en la cola. Lo llama la descarga inmediata y también
 *  el cron, que recoge lo que falló. */
export async function bajarUno(supabase: Sb, medioId: string): Promise<boolean> {
  const c = config()
  const { data: medio } = await supabase
    .from('whatsapp_medios')
    .select('*, crm_conversaciones ( cuenta_id, wa_id )')
    .eq('id', medioId)
    .maybeSingle()
  if (!medio || medio.estado === 'DESCARGADO') return false

  // Pasada la ventana de 7 días del `media_id` no hay nada que intentar: se
  // marca VENCIDO con la verdad y se le vuelve a pedir la foto a la persona.
  if (medio.vence_at && Date.parse(medio.vence_at) < Date.now()) {
    await supabase
      .from('whatsapp_medios')
      .update({ estado: 'VENCIDO', error: 'El media_id de Meta expiró (7 días): el archivo ya no se puede recuperar.' })
      .eq('id', medioId)
    return false
  }

  const { data: cuenta } = await supabase
    .from('whatsapp_cuentas')
    .select('id, alias, transporte, estado, phone_number_id, api_version')
    .eq('id', medio.crm_conversaciones?.cuenta_id ?? medio.cuenta_id)
    .maybeSingle()
  if (!cuenta) return false

  let cliente
  try {
    cliente = await clienteDe(cuenta as CuentaTransporte, supabase, simuladorActivo())
  } catch (e) {
    if (e instanceof SinCredencial) {
      await fallar(supabase, medio, 'SIN_CREDENCIAL', e.message)
      return false
    }
    throw e
  }

  const url = await cliente.urlDeMedio(medio.media_id)
  if (!url.ok) {
    await fallar(supabase, medio, url.codigo ?? 'URL', url.error)
    return false
  }

  const archivo = await cliente.bajarMedio(url.url)
  if (!archivo.ok) {
    // 404 = la URL venció (vale 5 minutos). Se reintenta y en el próximo
    // intento se pide una URL nueva, que es lo correcto.
    await fallar(supabase, medio, archivo.codigo ?? 'DESCARGA', archivo.error)
    return false
  }

  const mime = archivo.mime ?? url.mime ?? medio.mime ?? null
  const ext = extensionDe(mime, medio.wamid)
  const sha = createHash('sha256').update(archivo.datos).digest('hex')

  // La ruta tiene que empezar por el id de la visita: lo exige
  // `ronda_adjuntar_evidencia`, y es lo que hace que la RLS de Storage de F4
  // pueda decidir quién puede verla.
  const carpeta = medio.visita_id ?? `conversacion/${medio.conversacion_id}`
  const nombre = `${(medio.wamid ?? medio.media_id).replace(/[^A-Za-z0-9._-]/g, '_')}.${ext}`
  const ruta = `${carpeta}/whatsapp/${String(medio.hito).toLowerCase()}/${nombre}`

  const { error: eSubida } = await supabase.storage
    .from(c.bucketEvidencia)
    .upload(ruta, archivo.datos, { contentType: mime ?? 'application/octet-stream', upsert: true })
  if (eSubida) {
    await fallar(supabase, medio, 'STORAGE', eSubida.message)
    return false
  }

  // Integridad: WhatsApp manda el sha256 en el payload. Si no cuadra, la fila
  // queda DUDOSA. No se borra y no se oculta: se marca, y lo consume el adr-02.
  const declarado = normalizarSha(medio.sha256_declarado)
  const integridad = !declarado ? 'SIN_VERIFICAR' : declarado === sha ? 'OK' : 'DUDOSA'

  await supabase
    .from('whatsapp_medios')
    .update({
      bucket: c.bucketEvidencia,
      path: ruta,
      mime,
      bytes: archivo.datos.byteLength,
      sha256: sha,
      integridad,
      estado: 'DESCARGADO',
      descargado_at: new Date().toISOString(),
      error: null,
      proximo_intento_at: null,
    })
    .eq('id', medioId)

  if (integridad === 'DUDOSA') {
    await supabase.from('ronda_eventos').insert({
      entidad: 'whatsapp_medios',
      entidad_id: medioId,
      accion: 'INTEGRIDAD_DUDOSA',
      actor_tipo: 'SISTEMA',
      canal: 'WHATSAPP',
      detalle: { sha256_calculado: sha, sha256_declarado: declarado, path: ruta },
    })
  }

  // Y ahora sí: la evidencia entra al módulo de rondas por la MISMA RPC que usa
  // la app propia, con su sha256, que es lo que la hace prueba.
  if (medio.visita_id && esEvidencia(medio.hito)) {
    const { randomUUID } = await import('node:crypto')
    const evidenciaId = randomUUID()
    const { error } = await supabase.rpc('ronda_adjuntar_evidencia', {
      p_id: evidenciaId,
      p_visita: medio.visita_id,
      p_tipo: tipoEvidencia(mime, medio.voz),
      p_path: ruta,
      p_meta: {
        sha256: sha,
        mime,
        tamano: archivo.datos.byteLength,
        origen: 'WHATSAPP',
        // Se dice explícitamente que WhatsApp borra el EXIF cuando la imagen
        // viene como `image`: así nadie lee el silencio como «no había».
        exif: medio.con_exif ? { conservado: true, via: 'DOCUMENTO' } : { conservado: false, via: 'IMAGEN' },
      },
      p_persona: null,
    })
    if (!error) {
      await supabase.from('whatsapp_medios').update({ evidencia_id: evidenciaId }).eq('id', medioId)
    } else {
      // La evidencia no entró al módulo, pero el ARCHIVO ya está guardado y su
      // sha256 calculado: no se perdió nada, queda el rastro para resolverlo.
      await supabase.from('ronda_eventos').insert({
        entidad: 'whatsapp_medios',
        entidad_id: medioId,
        accion: 'EVIDENCIA_NO_ADJUNTADA',
        actor_tipo: 'SISTEMA',
        canal: 'WHATSAPP',
        detalle: { motivo: error.message, path: ruta },
      })
    }
  }

  return true
}

function esEvidencia(hito: string): boolean {
  return ['FOTO_INICIO', 'FOTO_FIN', 'TAREA', 'NOVEDAD'].includes(String(hito).toUpperCase())
}

function tipoEvidencia(mime: string | null, voz: boolean): string {
  const m = (mime ?? '').toLowerCase()
  if (voz || m.startsWith('audio/')) return 'AUDIO'
  if (m.startsWith('video/')) return 'VIDEO'
  if (m.startsWith('image/')) return 'FOTO'
  return 'ARCHIVO'
}

function normalizarSha(v: string | null): string | null {
  if (!v) return null
  const t = v.trim()
  if (/^[0-9a-fA-F]{64}$/.test(t)) return t.toLowerCase()
  // WhatsApp puede mandarlo en base64: 44 caracteres con relleno.
  try {
    const b = Buffer.from(t, 'base64')
    if (b.length === 32) return b.toString('hex')
  } catch {
    /* no era base64 */
  }
  return null
}

async function fallar(supabase: Sb, medio: any, codigo: string, error: string): Promise<void> {
  const intentos = Number(medio.intentos ?? 0) + 1
  // Tres intentos con espera 5 s / 30 s / 120 s, todos dentro de la ventana de
  // 7 días del media_id. Si se agotan, la visita NO se bloquea: queda la
  // novedad y el bot le pide la foto otra vez a la persona.
  const esperas = [5, 30, 120]
  const agotado = intentos > esperas.length
  await supabase
    .from('whatsapp_medios')
    .update({
      estado: agotado ? 'ERROR' : 'PENDIENTE',
      intentos,
      error: `${codigo}: ${error}`.slice(0, 500),
      proximo_intento_at: agotado
        ? null
        : new Date(Date.now() + esperas[intentos - 1] * 1000).toISOString(),
    })
    .eq('id', medio.id)

  if (agotado) {
    await supabase.from('ronda_eventos').insert({
      entidad: 'whatsapp_medios',
      entidad_id: medio.id,
      accion: 'EVIDENCIA_NO_DESCARGADA',
      actor_tipo: 'SISTEMA',
      canal: 'WHATSAPP',
      detalle: { wamid: medio.wamid, media_id: medio.media_id, motivo: `${codigo}: ${error}` },
    })
  }
}

export interface ResultadoMedios {
  bajados: number
  fallidos: number
  vencidos: number
}

/** Recoge lo que quedó pendiente de bajar. Lo llama el cron de entrada. */
export async function procesarMedios(supabase: Sb, limite = 20): Promise<ResultadoMedios> {
  const res: ResultadoMedios = { bajados: 0, fallidos: 0, vencidos: 0 }
  const { data } = await supabase
    .from('whatsapp_medios')
    .select('id, vence_at')
    .eq('estado', 'PENDIENTE')
    .or(`proximo_intento_at.is.null,proximo_intento_at.lte.${new Date().toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(limite)

  for (const m of (data ?? []) as any[]) {
    if (m.vence_at && Date.parse(m.vence_at) < Date.now()) {
      res.vencidos++
      await supabase
        .from('whatsapp_medios')
        .update({ estado: 'VENCIDO', error: 'El media_id de Meta expiró (7 días).' })
        .eq('id', m.id)
      continue
    }
    const ok = await bajarUno(supabase, m.id)
    if (ok) res.bajados++
    else res.fallidos++
  }
  return res
}
