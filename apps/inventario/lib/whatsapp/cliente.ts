import 'server-only'

// La capa de transporte, detrás de UNA interfaz con DOS implementaciones.
//
// Es la decisión §2.2 del ADR-01 hecha código: se puede empezar por un BSP y
// pasar a Meta directo sin tocar el motor, y —lo que importa hoy— se puede
// construir y probar el módulo ENTERO sin una sola credencial.
//
//   · `ClienteMeta`     — la Cloud API de verdad (o el proxy de un BSP).
//   · `ClienteSimulado` — no sale nada hacia un teléfono. Registra lo que se
//                         HABRÍA enviado, con el MISMO payload que iría a Meta
//                         y respetando los MISMOS límites, para que un mensaje
//                         que no cabría en WhatsApp falle también simulado. Un
//                         simulador más permisivo que la realidad no prueba
//                         nada.
//
// Qué NO hace el cliente: no decide si un mensaje puede salir. Eso ya lo
// decidió el portero en la base. El cliente manda o explica por qué no pudo.

import { aPayloadMeta, describir, type MensajeSaliente } from './mensajes'
import { config } from './config'
import { descifrar } from './cifrado'

export interface Enviado {
  ok: true
  wamid: string | null
  /** El payload que salió (o que habría salido). Se guarda en el mensaje para
   *  poder reconstruir después qué se mandó exactamente. */
  payload: Record<string, unknown>
  simulado: boolean
}

export interface FallaEnvio {
  ok: false
  /** Código de Meta. Los que el motor trata especial: `130429` (caudal, no
   *  cuenta como fallo del mensaje) y `190` (token inválido, detiene la cola). */
  codigo: string | null
  error: string
  payload: Record<string, unknown>
}

export type ResultadoEnvio = Enviado | FallaEnvio

export interface ClienteWhatsapp {
  readonly simulado: boolean
  enviar(destino: string, mensaje: MensajeSaliente): Promise<ResultadoEnvio>
  /** URL temporal de un medio. La de Meta vale 5 MINUTOS. */
  urlDeMedio(mediaId: string): Promise<{ ok: true; url: string; mime: string | null; bytes: number | null } | FallaEnvio>
  /** Baja el archivo. Contra Meta hace falta mandar el token en el header
   *  `Authorization`: «if you omit your token, the request will fail». */
  bajarMedio(url: string): Promise<{ ok: true; datos: Uint8Array; mime: string | null } | FallaEnvio>
}

export interface CuentaTransporte {
  id: string
  alias: string
  transporte: 'META' | 'BSP' | 'SIMULADOR'
  estado: string
  phone_number_id: string | null
  api_version: string | null
}

/* ───────────────────────────────── Simulador ──────────────────────────────── */

/** Lo que el simulador registró, para que la pantalla de pruebas lo pinte. */
export interface RegistroSimulado {
  destino: string
  mensaje: MensajeSaliente
  payload: Record<string, unknown>
  texto: string
  wamid: string
  momento: string
}

export class ClienteSimulado implements ClienteWhatsapp {
  readonly simulado = true
  private readonly registro: RegistroSimulado[] = []

  constructor(private readonly prefijoWamid = 'wamid.SIM') {}

  async enviar(destino: string, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    let payload: Record<string, unknown>
    try {
      // `aPayloadMeta` valida los límites. Que falle acá es el punto: así un
      // mensaje demasiado largo se descubre en una prueba y no en una portería.
      payload = aPayloadMeta(destino, mensaje)
    } catch (e) {
      return {
        ok: false,
        codigo: 'LIMITE',
        error: e instanceof Error ? e.message : 'El mensaje no cabe en WhatsApp.',
        payload: {},
      }
    }
    const wamid = `${this.prefijoWamid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`
    this.registro.push({
      destino,
      mensaje,
      payload,
      texto: describir(mensaje),
      wamid,
      momento: new Date().toISOString(),
    })
    return { ok: true, wamid, payload, simulado: true }
  }

  async urlDeMedio(mediaId: string) {
    // En el simulador los medios se leen de `_simulacion/` en el mismo bucket,
    // con la misma ruta de subida y el mismo cálculo de sha256 que en real.
    return { ok: true as const, url: `simulacion://${mediaId}`, mime: null, bytes: null }
  }

  async bajarMedio(url: string) {
    const id = url.replace('simulacion://', '')
    // Un contenido determinista por media_id: así el sha256 que calcula el
    // motor es estable entre corridas y la prueba se puede repetir.
    const texto = `medio simulado ${id}`
    return { ok: true as const, datos: new TextEncoder().encode(texto), mime: 'application/octet-stream' }
  }

  /** Lo registrado hasta ahora. Lo consume la pantalla de pruebas. */
  loEnviado(): RegistroSimulado[] {
    return [...this.registro]
  }
}

/* ────────────────────────────────── Meta / BSP ────────────────────────────── */

export class ClienteMeta implements ClienteWhatsapp {
  readonly simulado = false

  constructor(
    private readonly phoneNumberId: string,
    private readonly token: string,
    private readonly opciones: { baseUrl?: string; apiVersion?: string; esBsp?: boolean } = {},
  ) {}

  private base(): string {
    const c = config()
    if (this.opciones.esBsp && c.bspBaseUrl) return c.bspBaseUrl
    const raiz = this.opciones.baseUrl ?? c.graphBaseUrl
    const version = this.opciones.apiVersion ?? c.apiVersion
    return `${raiz.replace(/\/+$/, '')}/${version}`
  }

  private cabeceras(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }
  }

  async enviar(destino: string, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    let payload: Record<string, unknown>
    try {
      payload = aPayloadMeta(destino, mensaje)
    } catch (e) {
      return {
        ok: false,
        codigo: 'LIMITE',
        error: e instanceof Error ? e.message : 'El mensaje no cabe en WhatsApp.',
        payload: {},
      }
    }

    try {
      const r = await fetch(`${this.base()}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: this.cabeceras(),
        body: JSON.stringify(payload),
      })
      const cuerpo: unknown = await r.json().catch(() => null)
      if (!r.ok) return { ...leerError(cuerpo, r.status), payload }
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const wamid = (cuerpo as any)?.messages?.[0]?.id ?? null
      return { ok: true, wamid: typeof wamid === 'string' ? wamid : null, payload, simulado: false }
    } catch (e) {
      // Un fallo de red NO es un fallo del mensaje: el motor lo reintenta.
      return { ok: false, codigo: 'RED', error: e instanceof Error ? e.message : 'Error de red', payload }
    }
  }

  async urlDeMedio(mediaId: string) {
    try {
      const r = await fetch(`${this.base()}/${encodeURIComponent(mediaId)}`, { headers: this.cabeceras() })
      const cuerpo: unknown = await r.json().catch(() => null)
      if (!r.ok) return { ...leerError(cuerpo, r.status), payload: {} }
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const c = cuerpo as any
      if (typeof c?.url !== 'string') {
        return { ok: false as const, codigo: 'SIN_URL', error: 'Meta no devolvió la URL del medio.', payload: {} }
      }
      return {
        ok: true as const,
        url: c.url,
        mime: typeof c.mime_type === 'string' ? c.mime_type : null,
        bytes: Number.isFinite(Number(c.file_size)) ? Number(c.file_size) : null,
      }
    } catch (e) {
      return { ok: false as const, codigo: 'RED', error: e instanceof Error ? e.message : 'Error de red', payload: {} }
    }
  }

  async bajarMedio(url: string) {
    try {
      // El token va SIEMPRE: sin él la descarga falla, y la URL caducó a los 5
      // minutos de pedirla.
      const r = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } })
      if (!r.ok) {
        // 404 = la URL venció. El motor pide una nueva y reintenta.
        return {
          ok: false as const,
          codigo: String(r.status),
          error: r.status === 404 ? 'La URL del medio venció: hay que pedirla otra vez.' : `HTTP ${r.status}`,
          payload: {},
        }
      }
      const buf = new Uint8Array(await r.arrayBuffer())
      return { ok: true as const, datos: buf, mime: r.headers.get('content-type') }
    } catch (e) {
      return { ok: false as const, codigo: 'RED', error: e instanceof Error ? e.message : 'Error de red', payload: {} }
    }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function leerError(cuerpo: unknown, estado: number): Omit<FallaEnvio, 'payload'> {
  const e = (cuerpo as any)?.error
  const codigo = e?.code !== undefined && e?.code !== null ? String(e.code) : String(estado)
  const detalle =
    [e?.message, e?.error_data?.details].filter((x) => typeof x === 'string' && x).join(' · ') ||
    `HTTP ${estado}`
  // El mensaje de error NUNCA lleva el token: este texto termina en la base y
  // en la consola.
  return { ok: false, codigo, error: detalle.slice(0, 500) }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ───────────────────────────────── Fábrica ────────────────────────────────── */

export class SinCredencial extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'SinCredencial'
  }
}

/**
 * El cliente que le corresponde a una cuenta.
 *
 * El simulador gana si la cuenta dice `SIMULADOR` **o** si está puesta la
 * variable `WHATSAPP_SIMULADOR=1`. Las dos condiciones, no una: así ni un error
 * de configuración de la cuenta ni un despliegue de pruebas pueden mandar un
 * mensaje a un teléfono de verdad.
 */
export async function clienteDe(
  cuenta: CuentaTransporte,
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  supabase: any,
  simuladorForzado = false,
): Promise<ClienteWhatsapp> {
  if (simuladorForzado || cuenta.transporte === 'SIMULADOR' || cuenta.estado === 'SIMULADA') {
    return new ClienteSimulado()
  }
  if (!cuenta.phone_number_id) {
    throw new SinCredencial('La cuenta no tiene phone_number_id: hay que conectar el número primero.')
  }

  const tipo = cuenta.transporte === 'BSP' ? 'BSP_API_KEY' : 'BUSINESS_TOKEN'
  const { data } = await supabase
    .from('whatsapp_credenciales')
    .select('token_cifrado, estado')
    .eq('cuenta_id', cuenta.id)
    .eq('tipo', tipo)
    .eq('estado', 'ACTIVA')
    .maybeSingle()

  if (!data?.token_cifrado) {
    throw new SinCredencial(
      `No hay credencial ACTIVA de tipo ${tipo} para la cuenta ${cuenta.alias}: hay que volver a conectar el número.`,
    )
  }

  let token: string
  try {
    token = descifrar(data.token_cifrado as string)
  } catch {
    // No se dice más: cualquier detalle de por qué falló el descifrado es
    // información sobre el secreto.
    throw new SinCredencial('No se pudo leer la credencial guardada (¿cambió WHATSAPP_TOKEN_LLAVE?).')
  }

  return new ClienteMeta(cuenta.phone_number_id, token, {
    apiVersion: cuenta.api_version ?? undefined,
    esBsp: cuenta.transporte === 'BSP',
  })
}
