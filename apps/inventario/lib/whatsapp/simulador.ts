// El simulador de conversaciones (§9.1 del ADR-01).
//
// POR QUÉ NO ES UNA RUTA PARALELA: lo que se teclea en el simulador ARMA UN
// PAYLOAD REAL DE WEBHOOK, lo firma con el `WHATSAPP_APP_SECRET` local y lo
// manda a `/api/whatsapp/webhook`. Es decir: se prueba el camino completo —la
// verificación de la firma, la deduplicación, la cola, la máquina, el portero y
// el buzón de salida— y no un atajo que no probaría nada de eso.
//
// Las formas de los payloads son las de la referencia de Meta, con los valores
// de ejemplo de su propia documentación (`102290129340398`,
// `106540352242922`). Los números de teléfono son INVENTADOS y fuera de rangos
// reales: este repositorio es público.
//
// Qué NO prueba el simulador y hay que hacer a mano una vez con un número real:
// el flujo de Embedded Signup en coexistencia (hay una persona tocando botones
// en un teléfono), la sincronización de contactos e historial (que corre UNA
// sola vez) y el eco `smb_message_echoes` cuando alguien responde desde la app.

import { firmar } from './firma'

/** Los valores de ejemplo de la documentación de Meta. */
export const EJEMPLO = {
  wabaId: '102290129340398',
  phoneNumberId: '106540352242922',
  displayPhoneNumber: '15550783881',
} as const

export type ClaseSimulada =
  | 'texto'
  | 'boton'
  | 'lista'
  | 'ubicacion'
  | 'imagen'
  | 'audio'
  | 'documento'
  | 'sticker'
  | 'estado'

export interface EntradaSimulada {
  clase: ClaseSimulada
  waId: string
  perfil?: string | null
  texto?: string | null
  /** El id del botón o de la fila. Es el que emitió el bot. */
  idRespuesta?: string | null
  tituloRespuesta?: string | null
  lat?: number | null
  lng?: number | null
  nombreUbicacion?: string | null
  direccionUbicacion?: string | null
  mediaId?: string | null
  mime?: string | null
  sha256?: string | null
  voz?: boolean
  nombreArchivo?: string | null
  /** Con qué mensaje del bot se responde (`context.id`). */
  contextoWamid?: string | null
  /** Para `clase: 'estado'`. */
  wamidDestino?: string | null
  estadoEntrega?: 'sent' | 'delivered' | 'read' | 'failed'
  /** Un wamid fijo, para probar la deduplicación mandando el mismo dos veces. */
  wamid?: string | null
  /** Segundos. Para probar eventos desordenados. */
  momento?: number | null
}

let contador = 0

/** Un wamid con la forma real de Meta: `wamid.` más base64. */
export function nuevoWamid(semilla?: string): string {
  contador++
  const cuerpo = `${semilla ?? 'SIM'}-${Date.now()}-${contador}`
  return 'wamid.' + Buffer.from(cuerpo, 'utf8').toString('base64')
}

/** Arma el cuerpo del webhook tal como lo mandaría Meta. */
export function armarPayload(e: EntradaSimulada): Record<string, unknown> {
  const ts = String(e.momento ?? Math.floor(Date.now() / 1000))
  const metadata = {
    display_phone_number: EJEMPLO.displayPhoneNumber,
    phone_number_id: EJEMPLO.phoneNumberId,
  }

  if (e.clase === 'estado') {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: EJEMPLO.wabaId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata,
                statuses: [
                  {
                    id: e.wamidDestino ?? nuevoWamid('OUT'),
                    status: e.estadoEntrega ?? 'delivered',
                    timestamp: ts,
                    recipient_id: e.waId,
                    conversation: { id: 'conv-simulada', origin: { type: 'service' } },
                    pricing: { billable: true, pricing_model: 'CBP', category: 'service' },
                    ...(e.estadoEntrega === 'failed'
                      ? { errors: [{ code: 131026, title: 'Message undeliverable' }] }
                      : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    }
  }

  const wamid = e.wamid ?? nuevoWamid(e.clase)
  const base: Record<string, unknown> = {
    from: e.waId,
    id: wamid,
    timestamp: ts,
    ...(e.contextoWamid ? { context: { from: EJEMPLO.displayPhoneNumber, id: e.contextoWamid } } : {}),
  }

  let mensaje: Record<string, unknown>
  switch (e.clase) {
    case 'texto':
      mensaje = { ...base, type: 'text', text: { body: e.texto ?? '' } }
      break
    case 'boton':
      mensaje = {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: e.idRespuesta ?? '', title: e.tituloRespuesta ?? '' },
        },
      }
      break
    case 'lista':
      mensaje = {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: {
            id: e.idRespuesta ?? '',
            title: e.tituloRespuesta ?? '',
            description: '',
          },
        },
      }
      break
    case 'ubicacion':
      mensaje = {
        ...base,
        type: 'location',
        location: {
          latitude: e.lat ?? 0,
          longitude: e.lng ?? 0,
          ...(e.nombreUbicacion ? { name: e.nombreUbicacion } : {}),
          ...(e.direccionUbicacion ? { address: e.direccionUbicacion } : {}),
        },
      }
      break
    case 'imagen':
      mensaje = {
        ...base,
        type: 'image',
        image: {
          id: e.mediaId ?? `media-${wamid.slice(-10)}`,
          mime_type: e.mime ?? 'image/jpeg',
          sha256: e.sha256 ?? 'c2FoYS1zaW11bGFkby1lbi1iYXNlNjQtcGFyYS1wcnVlYmFzPT0=',
          ...(e.texto ? { caption: e.texto } : {}),
        },
      }
      break
    case 'audio':
      mensaje = {
        ...base,
        type: 'audio',
        audio: {
          id: e.mediaId ?? `media-${wamid.slice(-10)}`,
          mime_type: e.mime ?? 'audio/ogg; codecs=opus',
          sha256: e.sha256 ?? 'YXVkaW8tc2ltdWxhZG8tZW4tYmFzZTY0LXBhcmEtcHJ1ZWJhcz0=',
          voice: e.voz !== false,
        },
      }
      break
    case 'documento':
      mensaje = {
        ...base,
        type: 'document',
        document: {
          id: e.mediaId ?? `media-${wamid.slice(-10)}`,
          mime_type: e.mime ?? 'application/pdf',
          sha256: e.sha256 ?? 'ZG9jLXNpbXVsYWRvLWVuLWJhc2U2NC1wYXJhLXBydWViYXM9',
          filename: e.nombreArchivo ?? 'documento.pdf',
        },
      }
      break
    case 'sticker':
      mensaje = {
        ...base,
        type: 'sticker',
        sticker: { id: e.mediaId ?? 'sticker-1', mime_type: 'image/webp', sha256: 'c3RpY2tlcg==', animated: false },
      }
      break
    default:
      mensaje = { ...base, type: 'unknown', errors: [{ code: 131051, title: 'Unsupported message type' }] }
  }

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: EJEMPLO.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata,
              contacts: [{ profile: { name: e.perfil ?? 'Prueba' }, wa_id: e.waId }],
              messages: [mensaje],
            },
          },
        ],
      },
    ],
  }
}

/** El cuerpo y la cabecera de firma, listos para mandar al webhook. */
export function firmado(
  payload: Record<string, unknown>,
  secreto: string,
): { cuerpo: string; firma: string } {
  // Se serializa UNA vez y se firma ESE texto: el cuerpo que se manda y el que
  // se firma tienen que ser los mismos bytes.
  const cuerpo = JSON.stringify(payload)
  return { cuerpo, firma: firmar(cuerpo, secreto) }
}

/** Mete N actualizaciones en un solo POST, que es lo que Meta hace: un POST
 *  puede traer hasta 1.000 agrupadas y el agrupamiento no está garantizado. */
export function agrupar(payloads: Record<string, unknown>[]): Record<string, unknown> {
  const entradas = payloads.flatMap((p) => (p.entry as unknown[]) ?? [])
  return { object: 'whatsapp_business_account', entry: entradas }
}
