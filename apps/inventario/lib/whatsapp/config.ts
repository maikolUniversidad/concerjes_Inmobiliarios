// Configuración del canal de WhatsApp (Puntos QR F9).
//
// LA REGLA: nada que dependa de Meta está incrustado en el código. Lo que vive
// en el entorno son solo los secretos de la APP de Meta, que son los mismos
// para todos los clientes. El `waba_id`, el `phone_number_id` y los tokens son
// POR CLIENTE y viven en `whatsapp_cuentas` / `whatsapp_credenciales`, porque
// se obtienen en tiempo de ejecución cuando termina Embedded Signup.
//
// Si falta la configuración, TODO funciona menos el envío real: el webhook
// recibe (firmado localmente), la máquina de estados corre, la evidencia se
// guarda y el simulador deja ver cada mensaje tal como saldría.

/** ¿Está activo el simulador? Con esto, nada sale hacia un teléfono. */
export function simuladorActivo(): boolean {
  return process.env.WHATSAPP_SIMULADOR === '1'
}

/** El app secret con el que Meta firma `X-Hub-Signature-256`. */
export function appSecret(): string | null {
  const s = process.env.WHATSAPP_APP_SECRET
  return s && s.length > 0 ? s : null
}

/** La cadena que Meta devuelve en el reto de suscripción (`GET`). */
export function verifyToken(): string | null {
  const t = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  return t && t.length > 0 ? t : null
}

function numero(clave: string, porDefecto: number): number {
  const n = Number(process.env[clave])
  return Number.isFinite(n) && n > 0 ? n : porDefecto
}

export interface ConfigWhatsapp {
  /** Base de Graph API. Es configuración y no constante: las versiones de Graph
   *  duran unos dos años y Embedded Signup v2/v3 ya tiene fecha de muerte. */
  graphBaseUrl: string
  apiVersion: string
  /** Tope propio de caudal. El del número en coexistencia es 20 y no se puede
   *  subir; se trabaja por debajo para dejar margen. */
  throughputMps: number
  /** Margen sobre la ventana de 24 h de Meta. Tomarla justa es garantizar que
   *  el mensaje encolado en el minuto 1.439 llegue tarde. */
  ventanaSeguridadHoras: number
  /** Franja de respaldo cuando no hay regla de contrato ni turno programado.
   *  Es una red de seguridad, no una política. */
  jornadaDesde: string
  jornadaHasta: string
  zonaHoraria: string
  bucketEvidencia: string
  /** Transporte del BSP, cuando la cuenta dice `BSP`. */
  bspBaseUrl: string | null
  bspApiKey: string | null
  /** Config de Embedded Signup. Sin esto la pantalla de conexión dice
   *  «Sin configurar» en vez de romperse. */
  embeddedSignupConfigId: string | null
  embeddedSignupFeatureType: string
  appId: string | null
}

export function config(): ConfigWhatsapp {
  const jornada = (process.env.WHATSAPP_JORNADA_FALLBACK || '06:00-20:00').split('-')
  const hora = (v: string | undefined, pd: string) =>
    v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : pd
  return {
    graphBaseUrl: process.env.WHATSAPP_GRAPH_BASE_URL || 'https://graph.facebook.com',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v26.0',
    throughputMps: Math.min(numero('WHATSAPP_THROUGHPUT_MPS', 15), 20),
    ventanaSeguridadHoras: Math.min(numero('WHATSAPP_VENTANA_SEGURIDAD_HORAS', 23), 24),
    jornadaDesde: hora(jornada[0], '06:00'),
    jornadaHasta: hora(jornada[1], '20:00'),
    zonaHoraria: process.env.WHATSAPP_ZONA_HORARIA || 'America/Bogota',
    bucketEvidencia: process.env.WHATSAPP_BUCKET_EVIDENCIA || 'rondas',
    bspBaseUrl: process.env.WHATSAPP_BSP_BASE_URL || null,
    bspApiKey: process.env.WHATSAPP_BSP_API_KEY || null,
    embeddedSignupConfigId: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || null,
    embeddedSignupFeatureType:
      process.env.WHATSAPP_EMBEDDED_SIGNUP_FEATURE_TYPE || 'whatsapp_business_app_onboarding',
    appId: process.env.WHATSAPP_APP_ID || null,
  }
}

/** Lo que le falta a la configuración para poder mandar algo de verdad. Se
 *  muestra en la consola: es más útil que un error en tiempo de envío. */
export function faltantes(): string[] {
  const f: string[] = []
  if (!appSecret()) f.push('WHATSAPP_APP_SECRET')
  if (!verifyToken()) f.push('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
  if (!process.env.WHATSAPP_APP_ID) f.push('WHATSAPP_APP_ID')
  if (!process.env.WHATSAPP_TOKEN_LLAVE) f.push('WHATSAPP_TOKEN_LLAVE')
  return f
}
