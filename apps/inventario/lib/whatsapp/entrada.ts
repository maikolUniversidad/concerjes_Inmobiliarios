// Lectura de lo que llega por el webhook.
//
// TODO LO QUE ENTRA POR AQUÍ ES DATO HOSTIL, nunca instrucción. El endpoint es
// público: la firma dice que el cuerpo lo armó quien tiene el app secret, no
// que su contenido sea verdad. Un `text.body` es texto que escribió alguien, y
// lo único que se hace con él es compararlo contra una lista cerrada de comandos
// y contra códigos de punto que ya existen en la base. Nada de lo que llegue
// decide qué función se llama ni a qué fila se escribe.
//
// Las formas exactas de cada payload salen de la referencia de webhooks de
// Meta. Aquí NO se inventan: lo que no se reconoce se guarda como
// NO_SOPORTADO y se responde que no se entendió, nunca se adivina.

import { createHash } from 'node:crypto'

export type ClaseEvento =
  | 'TEXTO'
  | 'BOTON'
  | 'LISTA'
  | 'UBICACION'
  | 'IMAGEN'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENTO'
  | 'STICKER'
  | 'CONTACTO'
  | 'REACCION'
  | 'NO_SOPORTADO'

/** Un mensaje entrante ya normalizado. Lo consume la máquina de estados, que no
 *  conoce la forma de los payloads de Meta. */
export interface EntranteNormalizado {
  clase: ClaseEvento
  wamid: string
  waId: string
  phoneNumberId: string | null
  perfilNombre: string | null
  momento: string
  texto: string | null
  /** `button_reply.id` o `list_reply.id`. Es el único «dato» de un entrante que
   *  el bot usa para enrutar, y aun así se valida contra lo que él mismo
   *  ofreció: un id que no reconoce se trata como texto que no se entiende. */
  idRespuesta: string | null
  tituloRespuesta: string | null
  lat: number | null
  lng: number | null
  nombreUbicacion: string | null
  direccionUbicacion: string | null
  /** `context.id`: con qué mensaje del bot se está respondiendo. Es lo que
   *  permite casar una ubicación con la solicitud que la pidió. */
  contextoWamid: string | null
  mediaId: string | null
  mime: string | null
  sha256Declarado: string | null
  /** Una nota de voz (`audio.voice = true`) no es lo mismo que un audio
   *  adjunto: la nota se transcribe, el archivo adjunto no. */
  voz: boolean
  /** Una imagen que llegó como `document` conserva los metadatos EXIF. */
  comoDocumento: boolean
  nombreArchivo: string | null
  /** `messages[].errors`, p. ej. `type: unsupported`. */
  errores: { code?: number; title?: string; message?: string }[]
  /** El eco de un mensaje que alguien mandó desde la app del teléfono. NO abre
   *  ni afecta la ventana de 24 horas. */
  eco: boolean
  payload: unknown
}

export interface EstadoEntrega {
  wamid: string
  estado: string
  momento: string
  waId: string | null
  codigoError: string | null
  error: string | null
  payload: unknown
}

export interface EventoCrudo {
  tipoCampo: string
  dedup: string
  wamid: string | null
  waId: string | null
  phoneNumberId: string | null
  momento: string | null
  payload: unknown
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const obj = (v: unknown): Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const txt = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** El `timestamp` de Meta viene en segundos, como cadena. Es la prueba de
 *  CUÁNDO, porque de la foto no se puede sacar (WhatsApp le borra el EXIF). */
function momentoDe(v: unknown): string | null {
  const n = num(v)
  if (n === null || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

/**
 * Descompone un `POST` del webhook en eventos sueltos, uno por actualización.
 *
 * Un solo POST puede traer HASTA 1.000 actualizaciones agrupadas, y el
 * agrupamiento no está garantizado: hay que tratar cada una por separado y
 * guardarlas todas en una sola transacción.
 */
export function descomponer(cuerpo: unknown): EventoCrudo[] {
  const salida: EventoCrudo[] = []
  for (const entrada of arr(obj(cuerpo).entry)) {
    for (const cambio of arr(obj(entrada).changes)) {
      const c = obj(cambio)
      const campo = txt(c.field) ?? 'desconocido'
      const valor = obj(c.value)
      const phoneId = txt(obj(valor.metadata).phone_number_id)

      const mensajes = arr(valor.messages)
      const ecos = arr(valor.message_echoes)
      const estados = arr(valor.statuses)

      for (const m of [...mensajes, ...ecos]) {
        const msj = obj(m)
        const wamid = txt(msj.id)
        if (!wamid) continue
        salida.push({
          tipoCampo: campo,
          dedup: wamid,
          wamid,
          waId: txt(msj.from),
          phoneNumberId: phoneId,
          momento: momentoDe(msj.timestamp),
          payload: { field: campo, metadata: valor.metadata, contacts: valor.contacts, message: msj },
        })
      }

      for (const s of estados) {
        const est = obj(s)
        const wamid = txt(est.id)
        salida.push({
          tipoCampo: campo || 'statuses',
          // Un `statuses` no tiene llave propia: dos estados distintos del mismo
          // mensaje son dos eventos, así que la llave lleva también el estado.
          dedup: llaveDedup(campo, { id: wamid, status: est.status, ts: est.timestamp }),
          wamid,
          waId: txt(est.recipient_id),
          phoneNumberId: phoneId,
          momento: momentoDe(est.timestamp),
          payload: { field: campo, metadata: valor.metadata, status: est },
        })
      }

      // Lo que no es ni mensaje ni estado (cambios de cuenta, calidad del
      // número, estado de una plantilla) se guarda igual: no hay API para
      // recuperar un webhook viejo, así que lo que no se guarde se pierde.
      if (!mensajes.length && !ecos.length && !estados.length) {
        salida.push({
          tipoCampo: campo,
          dedup: llaveDedup(campo, valor),
          wamid: null,
          waId: null,
          phoneNumberId: phoneId,
          momento: null,
          payload: { field: campo, value: valor },
        })
      }
    }
  }
  return salida
}

/** Llave de deduplicación para lo que no trae `wamid`: sha256 del tipo de campo
 *  más el payload con las llaves ordenadas, para que el mismo contenido dé
 *  siempre el mismo hash. */
export function llaveDedup(tipoCampo: string, valor: unknown): string {
  return createHash('sha256').update(`${tipoCampo}:${normalizar(valor)}`).digest('hex')
}

function normalizar(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return '[' + v.map(normalizar).join(',') + ']'
  const e = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return '{' + e.map(([k, x]) => `${JSON.stringify(k)}:${normalizar(x)}`).join(',') + '}'
}

/** ¿Este evento es un mensaje de una persona (o el eco de uno de la app)? */
export function esMensaje(tipoCampo: string, payload: unknown): boolean {
  return !!obj(payload).message
}

export function esEstado(payload: unknown): boolean {
  return !!obj(payload).status
}

/** Normaliza un evento de mensaje a algo que la máquina pueda consumir. */
export function leerMensaje(evento: EventoCrudo): EntranteNormalizado | null {
  const p = obj(evento.payload)
  const m = obj(p.message)
  const wamid = txt(m.id)
  if (!wamid) return null

  const tipo = (txt(m.type) ?? '').toLowerCase()
  const inter = obj(m.interactive)
  const ctx = obj(m.context)
  const contacto = obj(arr(p.contacts)[0])
  const eco = (evento.tipoCampo || '').includes('echo')

  const base: EntranteNormalizado = {
    clase: 'NO_SOPORTADO',
    wamid,
    waId: txt(m.from) ?? evento.waId ?? '',
    phoneNumberId: evento.phoneNumberId,
    perfilNombre: txt(obj(contacto.profile).name),
    momento: evento.momento ?? new Date().toISOString(),
    texto: null,
    idRespuesta: null,
    tituloRespuesta: null,
    lat: null,
    lng: null,
    nombreUbicacion: null,
    direccionUbicacion: null,
    contextoWamid: txt(ctx.id),
    mediaId: null,
    mime: null,
    sha256Declarado: null,
    voz: false,
    comoDocumento: false,
    nombreArchivo: null,
    errores: arr(m.errors).map((e) => ({
      code: num(obj(e).code) ?? undefined,
      title: txt(obj(e).title) ?? undefined,
      message: txt(obj(e).message) ?? undefined,
    })),
    eco,
    payload: evento.payload,
  }

  switch (tipo) {
    case 'text':
      return { ...base, clase: 'TEXTO', texto: txt(obj(m.text).body) }

    case 'button':
      // Botón de una PLANTILLA (otra forma, no `interactive`).
      return {
        ...base,
        clase: 'BOTON',
        idRespuesta: txt(obj(m.button).payload),
        tituloRespuesta: txt(obj(m.button).text),
        texto: txt(obj(m.button).text),
      }

    case 'interactive': {
      const subtipo = (txt(inter.type) ?? '').toLowerCase()
      if (subtipo === 'button_reply') {
        const r = obj(inter.button_reply)
        return { ...base, clase: 'BOTON', idRespuesta: txt(r.id), tituloRespuesta: txt(r.title), texto: txt(r.title) }
      }
      if (subtipo === 'list_reply') {
        const r = obj(inter.list_reply)
        return { ...base, clase: 'LISTA', idRespuesta: txt(r.id), tituloRespuesta: txt(r.title), texto: txt(r.title) }
      }
      return base
    }

    case 'location': {
      const l = obj(m.location)
      // El webhook de ubicación NO trae precisión del GPS: no se puede
      // distinguir una lectura de ±5 m de una de ±500 m. Es un hueco conocido
      // y lo trata el adr-02.
      return {
        ...base,
        clase: 'UBICACION',
        lat: num(l.latitude),
        lng: num(l.longitude),
        nombreUbicacion: txt(l.name),
        direccionUbicacion: txt(l.address),
      }
    }

    case 'image': {
      const i = obj(m.image)
      return {
        ...base,
        clase: 'IMAGEN',
        mediaId: txt(i.id),
        mime: txt(i.mime_type),
        sha256Declarado: txt(i.sha256),
        texto: txt(i.caption),
      }
    }

    case 'audio': {
      const a = obj(m.audio)
      return {
        ...base,
        clase: 'AUDIO',
        mediaId: txt(a.id),
        mime: txt(a.mime_type),
        sha256Declarado: txt(a.sha256),
        voz: a.voice === true || a.voice === 'true',
      }
    }

    case 'video': {
      const v = obj(m.video)
      return {
        ...base,
        clase: 'VIDEO',
        mediaId: txt(v.id),
        mime: txt(v.mime_type),
        sha256Declarado: txt(v.sha256),
        texto: txt(v.caption),
      }
    }

    case 'document': {
      const d = obj(m.document)
      const mime = txt(d.mime_type)
      // Una imagen mandada COMO DOCUMENTO sí conserva los metadatos: se acepta
      // como foto y se marca `con_exif`, porque ahí hay prueba de verdad.
      const esImagen = !!mime && mime.startsWith('image/')
      return {
        ...base,
        clase: esImagen ? 'IMAGEN' : 'DOCUMENTO',
        mediaId: txt(d.id),
        mime,
        sha256Declarado: txt(d.sha256),
        nombreArchivo: txt(d.filename),
        texto: txt(d.caption),
        comoDocumento: true,
      }
    }

    case 'sticker':
      return { ...base, clase: 'STICKER', mediaId: txt(obj(m.sticker).id) }

    case 'contacts':
      return { ...base, clase: 'CONTACTO' }

    case 'reaction':
      return { ...base, clase: 'REACCION', texto: txt(obj(m.reaction).emoji) }

    default:
      return base
  }
}

export function leerEstado(evento: EventoCrudo): EstadoEntrega | null {
  const s = obj(obj(evento.payload).status)
  const wamid = txt(s.id)
  if (!wamid) return null
  const err = obj(arr(s.errors)[0])
  return {
    wamid,
    estado: (txt(s.status) ?? '').toLowerCase(),
    momento: evento.momento ?? new Date().toISOString(),
    waId: txt(s.recipient_id),
    codigoError: num(err.code) !== null ? String(num(err.code)) : null,
    error: txt(err.title) ?? txt(err.message),
    payload: evento.payload,
  }
}

/** El tipo de `crm_mensajes.tipo` que le corresponde a un entrante. */
export function tipoMensaje(clase: ClaseEvento): string {
  switch (clase) {
    case 'TEXTO':
      return 'TEXTO'
    case 'BOTON':
      return 'BOTONES'
    case 'LISTA':
      return 'LISTA'
    case 'UBICACION':
      return 'UBICACION'
    case 'IMAGEN':
      return 'IMAGEN'
    case 'AUDIO':
      return 'AUDIO'
    case 'VIDEO':
      return 'VIDEO'
    case 'DOCUMENTO':
      return 'DOCUMENTO'
    case 'STICKER':
      return 'STICKER'
    case 'CONTACTO':
      return 'CONTACTO'
    case 'REACCION':
      return 'REACCION'
    default:
      return 'NO_SOPORTADO'
  }
}
