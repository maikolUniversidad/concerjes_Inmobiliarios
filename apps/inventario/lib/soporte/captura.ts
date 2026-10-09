// Grabadora del navegador para el botón de bug.
// Se instala UNA vez al cargar el dashboard y guarda en memoria (anillos de
// tamaño fijo) lo último que pasó: consola, errores, peticiones de red, clics y
// navegación. Al reportar, `capturarContexto()` lo empaqueta junto con los datos
// del navegador. Nada sale del navegador hasta que el usuario envía el ticket.

export interface EntradaConsola { t: string; nivel: string; texto: string }
export interface EntradaRed { t: string; metodo: string; url: string; estado: number | null; ms: number; error?: string }
export interface EntradaAccion { t: string; tipo: 'clic' | 'navegacion' | 'tecla'; detalle: string }

export interface ContextoSoporte {
  capturado_at: string
  url: string
  ruta: string
  titulo_pagina: string
  referrer: string
  modulo: string | null
  version: string | null
  navegador: Record<string, unknown>
  pantalla: Record<string, unknown>
  rendimiento: Record<string, unknown>
  consola: EntradaConsola[]
  errores: EntradaConsola[]
  red: EntradaRed[]
  acciones: EntradaAccion[]
  almacenamiento: { local: string[]; session: string[] }
}

const MAX_CONSOLA = 200
const MAX_RED = 80
const MAX_ACCIONES = 40
const MAX_TEXTO = 2000

const consola: EntradaConsola[] = []
const errores: EntradaConsola[] = []
const red: EntradaRed[] = []
const acciones: EntradaAccion[] = []

function empujar<T>(arr: T[], item: T, max: number) {
  arr.push(item)
  if (arr.length > max) arr.splice(0, arr.length - max)
}

const ahora = () => new Date().toISOString()

/** Quita credenciales de una URL (tokens de URLs firmadas, apikey, etc.). */
export function limpiarUrl(u: string): string {
  try {
    const url = new URL(u, location.origin)
    for (const k of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|signature|auth|code/i.test(k)) url.searchParams.set(k, '***')
    }
    return url.origin === location.origin ? url.pathname + url.search : url.toString()
  } catch { return String(u).slice(0, 300) }
}

/** Oculta cosas con pinta de credencial dentro de un texto de log. */
function sanear(texto: string): string {
  return texto
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[JWT oculto]')
    .replace(/(token|apikey|api_key|password|secret)(["'\s:=]+)[^\s"',}]+/gi, '$1$2***')
}

function serializar(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
  if (typeof arg === 'string') return arg
  if (arg === undefined) return 'undefined'
  try {
    const visto = new WeakSet()
    return JSON.stringify(arg, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (visto.has(v)) return '[circular]'
        visto.add(v)
      }
      if (typeof v === 'function') return `[fn ${v.name || 'anónima'}]`
      if (typeof Element !== 'undefined' && v instanceof Element) return `<${v.tagName.toLowerCase()}>`
      return v
    })
  } catch { return String(arg) }
}

function textoDe(args: unknown[]): string {
  const t = args.map(serializar).join(' ')
  return sanear(t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO) + '…' : t)
}

/** Describe brevemente el elemento clicado: "button «Guardar»", "a[/stock]". */
function describirElemento(el: Element | null): string {
  if (!el) return '?'
  const interactivo = el.closest('button, a, [role="button"], input, select, textarea, label, [data-soporte]') ?? el
  const tag = interactivo.tagName.toLowerCase()
  const aria = interactivo.getAttribute('aria-label') || interactivo.getAttribute('title')
  const href = interactivo.getAttribute('href')
  const nombre = (interactivo as HTMLInputElement).name
  // En campos no se registra lo escrito, solo qué campo es.
  const texto = ['input', 'textarea', 'select'].includes(tag)
    ? `${(interactivo as HTMLInputElement).type || tag}${nombre ? ` name=${nombre}` : ''}`
    : (aria || interactivo.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return `${tag}${href ? `[${href}]` : ''}${texto ? ` «${texto}»` : ''}`
}

let instalada = false

export function instalarCaptura() {
  if (instalada || typeof window === 'undefined') return
  instalada = true

  // Consola
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[nivel].bind(console)
    console[nivel] = (...args: unknown[]) => {
      try {
        const e = { t: ahora(), nivel, texto: textoDe(args) }
        empujar(consola, e, MAX_CONSOLA)
        if (nivel === 'error') empujar(errores, e, 50)
      } catch { /* la grabadora nunca debe romper la consola */ }
      original(...args)
    }
  }

  // Errores no capturados
  window.addEventListener('error', (ev) => {
    const texto = ev.error ? serializar(ev.error) : `${ev.message} (${ev.filename}:${ev.lineno}:${ev.colno})`
    const e = { t: ahora(), nivel: 'uncaught', texto: sanear(texto).slice(0, MAX_TEXTO) }
    empujar(errores, e, 50); empujar(consola, e, MAX_CONSOLA)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const e = { t: ahora(), nivel: 'promise', texto: textoDe(['Promesa rechazada sin manejar:', ev.reason]) }
    empujar(errores, e, 50); empujar(consola, e, MAX_CONSOLA)
  })

  // Red (fetch). Solo método, URL limpia, estado y tiempo: nunca cuerpos ni headers.
  const fetchOriginal = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const inicio = performance.now()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const metodo = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    try {
      const res = await fetchOriginal(input, init)
      empujar(red, { t: ahora(), metodo, url: limpiarUrl(url), estado: res.status, ms: Math.round(performance.now() - inicio) }, MAX_RED)
      return res
    } catch (err) {
      empujar(red, { t: ahora(), metodo, url: limpiarUrl(url), estado: null, ms: Math.round(performance.now() - inicio), error: serializar(err).slice(0, 300) }, MAX_RED)
      throw err
    }
  }

  // Acciones del usuario
  document.addEventListener('click', (ev) => {
    // El propio botón de reporte no es un paso del problema.
    if ((ev.target as Element)?.closest?.('[data-soporte-ocultar]')) return
    try { empujar(acciones, { t: ahora(), tipo: 'clic', detalle: describirElemento(ev.target as Element) }, MAX_ACCIONES) } catch { /* nada */ }
  }, { capture: true })
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === 'Escape') {
      empujar(acciones, { t: ahora(), tipo: 'tecla', detalle: `${ev.key} en ${describirElemento(ev.target as Element)}` }, MAX_ACCIONES)
    }
  }, { capture: true })
}

/** Lo llama el shell cuando cambia la ruta (Next no recarga la página). */
export function registrarNavegacion(ruta: string) {
  const ultima = [...acciones].reverse().find((a) => a.tipo === 'navegacion')
  if (ultima?.detalle === ruta) return
  empujar(acciones, { t: ahora(), tipo: 'navegacion', detalle: ruta }, MAX_ACCIONES)
}

function claves(s: Storage | undefined): string[] {
  try { return s ? Object.keys(s).slice(0, 60) : [] } catch { return [] }
}

/** Empaqueta todo lo que se sabe en este momento. */
export function capturarContexto(modulo: string | null): ContextoSoporte {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
    deviceMemory?: number
    userAgentData?: { platform?: string; mobile?: boolean; brands?: { brand: string; version: string }[] }
  }
  const navEntry = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory

  return {
    capturado_at: ahora(),
    url: limpiarUrl(location.href),
    ruta: location.pathname,
    titulo_pagina: document.title,
    referrer: document.referrer ? limpiarUrl(document.referrer) : '',
    modulo,
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    navegador: {
      user_agent: nav.userAgent,
      plataforma: nav.userAgentData?.platform ?? nav.platform,
      movil: nav.userAgentData?.mobile ?? /Mobi|Android/i.test(nav.userAgent),
      marcas: nav.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', '),
      idioma: nav.language,
      zona_horaria: Intl.DateTimeFormat().resolvedOptions().timeZone,
      en_linea: nav.onLine,
      cookies: nav.cookieEnabled,
      conexion: nav.connection ? {
        tipo: nav.connection.effectiveType, mbps: nav.connection.downlink, rtt_ms: nav.connection.rtt, ahorro: nav.connection.saveData,
      } : null,
      memoria_gb: nav.deviceMemory ?? null,
      nucleos: nav.hardwareConcurrency ?? null,
      pwa: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    },
    pantalla: {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      pantalla: `${screen.width}x${screen.height}`,
      dpr: window.devicePixelRatio,
      orientacion: screen.orientation?.type ?? null,
      tema_oscuro: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
      scroll: `${Math.round(window.scrollX)},${Math.round(window.scrollY)}`,
    },
    rendimiento: {
      carga_ms: navEntry ? Math.round(navEntry.loadEventEnd - navEntry.startTime) : null,
      dom_listo_ms: navEntry ? Math.round(navEntry.domContentLoadedEventEnd - navEntry.startTime) : null,
      tiempo_en_pagina_s: Math.round(performance.now() / 1000),
      heap_mb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      heap_limite_mb: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
    },
    consola: [...consola],
    errores: [...errores],
    red: [...red],
    acciones: [...acciones],
    // Solo los nombres de las claves (nunca los valores: ahí vive la sesión).
    almacenamiento: { local: claves(window.localStorage), session: claves(window.sessionStorage) },
  }
}

/**
 * Captura de pantalla de lo que el usuario ve, como JPEG. Si el navegador no
 * puede (CORS, memoria), devuelve null y el ticket se crea sin imagen.
 */
export async function capturarPantalla(): Promise<Blob | null> {
  try {
    const { domToBlob } = await import('modern-screenshot')
    return await domToBlob(document.body, {
      type: 'image/jpeg',
      quality: 0.75,
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#f9fafb',
      // Sin esto la imagen sale corrida 8 px (margen por defecto del body clonado).
      style: { margin: '0' },
      timeout: 8000,
      filter: (n) => !(n instanceof Element && n.hasAttribute('data-soporte-ocultar')),
    })
  } catch (e) {
    console.warn('[soporte] no se pudo tomar la captura', e)
    return null
  }
}
