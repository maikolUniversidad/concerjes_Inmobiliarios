// Catálogos y utilidades del módulo de Mantenimiento de Maquinaria.
// Se usan tanto en la vista de campo (/equipo) como en el tablero (/mantenimiento).
// Las transiciones y reglas viven en la BD (RPC `mant_*`); aquí solo está lo visual.

// La forma del código de una placa la define `packages/ronda-core` y la
// comparten esta app y la móvil (§1.1 del complemento 2): aquí se usa, no se
// reimplementa.
import { clasificarEntrada, codigoDeEscaneo } from '@/lib/puntos-qr'

export const BUCKET_MANT = 'mantenimiento'

// Zona fija: el servidor (UTC en Vercel) y el navegador deben formatear igual
// o React falla al hidratar.
export const ZONA_HORARIA = 'America/Bogota'

/**
 * Los once estados del enum `estado_ticket_mant`, en el orden del ciclo de vida
 * (el mismo del enum en la base: F7 los insertó con BEFORE/AFTER para que
 * coincidan). Los cuatro de la orden de trabajo —`ACEPTADO`, `EN_CAMINO`,
 * `EN_SITIO`, `APROBADO_CLIENTE`— son OPCIONALES: el camino corto de siempre
 * para un correctivo de maquinaria sigue siendo
 * `ABIERTO → RECIBIDO → EN_PROCESO → RESUELTO → CERRADO`.
 */
export const ESTADOS_TICKET = [
  'ABIERTO', 'RECIBIDO', 'ACEPTADO', 'EN_CAMINO', 'EN_SITIO', 'EN_PROCESO',
  'EN_ESPERA', 'RESUELTO', 'APROBADO_CLIENTE', 'CERRADO', 'CANCELADO',
] as const
export type EstadoTicket = (typeof ESTADOS_TICKET)[number]

export const ESTADO_TICKET_META: Record<string, { label: string; cls: string; dot: string }> = {
  ABIERTO:          { label: 'Abierto',     cls: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
  RECIBIDO:         { label: 'Recibido',    cls: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-500' },
  ACEPTADO:         { label: 'Aceptada',    cls: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  EN_CAMINO:        { label: 'En camino',   cls: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500' },
  EN_SITIO:         { label: 'En sitio',    cls: 'bg-cyan-100 text-cyan-700',       dot: 'bg-cyan-500' },
  EN_PROCESO:       { label: 'En proceso',  cls: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  EN_ESPERA:        { label: 'En espera',   cls: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500' },
  RESUELTO:         { label: 'Resuelto',    cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  APROBADO_CLIENTE: { label: 'Aprobada por el cliente', cls: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
  CERRADO:          { label: 'Cerrado',     cls: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400' },
  CANCELADO:        { label: 'Cancelado',   cls: 'bg-gray-100 text-gray-400 line-through', dot: 'bg-gray-300' },
}

/**
 * LA ÚNICA LISTA. Las pestañas del tablero, los KPI y los contadores de la
 * ficha de campo salen de aquí, no de arreglos escritos a mano en cada
 * pantalla: antes había siete copias y un estado nuevo tenía que agregarse a
 * las siete.
 */
export const FASES_TICKET = {
  atender:   ['ABIERTO'],
  curso:     ['RECIBIDO', 'ACEPTADO', 'EN_CAMINO', 'EN_SITIO', 'EN_PROCESO', 'EN_ESPERA'],
  resueltos: ['RESUELTO', 'APROBADO_CLIENTE'],
  historial: ['CERRADO', 'CANCELADO'],
} as const

export type FaseTicket = keyof typeof FASES_TICKET

/**
 * Dónde cae un estado que NADIE clasificó. No es un detalle: el peor modo de
 * falla del tablero era silencioso —un ticket en un estado que no estaba en
 * ninguna lista no aparecía en ninguna pestaña, sin error y sin rastro—, así
 * que `faseTicket()` es TOTAL: siempre devuelve una fase. Un estado que alguien
 * agregue al enum mañana y olvide clasificar aquí cae en «En curso», que es una
 * pestaña visible y accionable, en vez de esfumarse.
 */
export const FASE_SI_NO_SE_CONOCE: FaseTicket = 'curso'

export function faseTicket(estado: string): FaseTicket {
  for (const fase of Object.keys(FASES_TICKET) as FaseTicket[]) {
    if ((FASES_TICKET[fase] as readonly string[]).includes(estado)) return fase
  }
  return FASE_SI_NO_SE_CONOCE
}

/** Los dos estados finales. Se filtra por lo que NO es trabajo pendiente, en
 *  negativo a propósito: un filtro positivo se olvidaría de un estado nuevo. */
export const ESTADOS_TICKET_FINALES = FASES_TICKET.historial

// Las dos se tipan `readonly string[]` y no como tupla de literales: se usan
// para preguntar `.includes(t.estado)` sobre un `estado` que llega de la base
// como `string`, y una tupla obligaría a castear en cada pantalla.
/** Trabajo pendiente: todo lo que no está cerrado ni cancelado. */
export const ESTADOS_TICKET_ACTIVOS: readonly string[] = ESTADOS_TICKET
  .filter((e) => !(ESTADOS_TICKET_FINALES as readonly string[]).includes(e))

/** En manos de mantenimiento ahora mismo (sin lo que espera confirmación). */
export const ESTADOS_TICKET_EN_CURSO: readonly string[] = [...FASES_TICKET.atender, ...FASES_TICKET.curso]

/** Para un `.not('estado', 'in', …)` de PostgREST. */
export const FILTRO_NO_FINAL = `(${ESTADOS_TICKET_FINALES.join(',')})`

export const ORIGEN_TICKET_META: Record<string, { label: string }> = {
  TICKET:  { label: 'Reporte de una persona' },
  PLAN:    { label: 'Plan preventivo' },
  VISITA:  { label: 'Novedad de una visita' },
  PQRS:    { label: 'PQRS' },
  CLIENTE: { label: 'Solicitud del cliente' },
  BOT:     { label: 'Bot de WhatsApp' },
  IOT:     { label: 'Sensor' },
}

/** Las acciones de `mant_transicion`. `EN_SITIO` NO está: lo escribe el
 *  escaneo de la placa (`mant_abrir_visita`), no un botón. */
export const ACCIONES_TICKET = [
  'RECIBIR', 'ASIGNAR', 'ACEPTAR', 'SALIR', 'INICIAR', 'ESPERA',
  'RESOLVER', 'APROBAR_CLIENTE', 'CERRAR', 'REABRIR', 'CANCELAR',
] as const
export type AccionTicket = (typeof ACCIONES_TICKET)[number]

// ── Planes preventivos (F7) ─────────────────────────────────────────────────

export const FRECUENCIAS_PLAN = ['DIAS', 'SEMANAS', 'MESES', 'MEDIDOR'] as const
export type FrecuenciaPlan = (typeof FRECUENCIAS_PLAN)[number]

// El singular va escrito, no derivado: «meses» → «mes», que ninguna regla de
// quitarle la s acierta.
export const FRECUENCIA_PLAN_META: Record<FrecuenciaPlan, { label: string; unidad: string; singular: string; ayuda: string }> = {
  DIAS:    { label: 'Cada N días',    unidad: 'días',     singular: 'día',     ayuda: 'Se cuenta desde el último preventivo resuelto.' },
  SEMANAS: { label: 'Cada N semanas', unidad: 'semanas',  singular: 'semana',  ayuda: 'Se cuenta desde el último preventivo resuelto.' },
  MESES:   { label: 'Cada N meses',   unidad: 'meses',    singular: 'mes',     ayuda: 'Lo normal para un plan normativo: la recarga anual del extintor son 12.' },
  MEDIDOR: { label: 'Por medidor',    unidad: 'unidades', singular: 'unidad',  ayuda: 'Cada N horas, ciclos o unidades del contador del activo. Exige elegir el medidor.' },
}

export const TIPO_PLAN_TICKET = ['PREVENTIVO', 'INSPECCION'] as const

/** Qué texto describe la frecuencia de un plan, para la tabla y la ficha. */
export function textoFrecuencia(tipo: string, valor: number, unidadMedidor?: string | null): string {
  const n = Number(valor)
  if (tipo === 'MEDIDOR') return `cada ${n} ${unidadMedidor || 'unidades'}`
  const meta = FRECUENCIA_PLAN_META[tipo as FrecuenciaPlan]
  if (!meta) return `cada ${n}`
  return `cada ${n} ${n === 1 ? meta.singular : meta.unidad}`
}

export const PRIORIDAD_META: Record<string, { label: string; cls: string; orden: number }> = {
  CRITICA: { label: 'Crítica', cls: 'bg-red-600 text-white',      orden: 0 },
  ALTA:    { label: 'Alta',    cls: 'bg-orange-100 text-orange-700', orden: 1 },
  MEDIA:   { label: 'Media',   cls: 'bg-yellow-100 text-yellow-700', orden: 2 },
  BAJA:    { label: 'Baja',    cls: 'bg-gray-100 text-gray-600',     orden: 3 },
}
export const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const

export const TIPO_TICKET_META: Record<string, { label: string; desc: string }> = {
  CORRECTIVO:     { label: 'Falla / daño',     desc: 'El equipo presenta una falla' },
  SOPORTE_REMOTO: { label: 'Soporte remoto',   desc: 'Necesito orientación por chat' },
  PREVENTIVO:     { label: 'Preventivo',       desc: 'Mantenimiento programado' },
  INSPECCION:     { label: 'Inspección',       desc: 'Revisión técnica programada' },
}

export const CONDICION_META: Record<string, { label: string; cls: string }> = {
  BUENA:   { label: 'Buena',   cls: 'bg-green-100 text-green-700' },
  REGULAR: { label: 'Regular', cls: 'bg-yellow-100 text-yellow-700' },
  MALA:    { label: 'Mala',    cls: 'bg-red-100 text-red-700' },
}

export const TIPO_ACTIVIDAD_META: Record<string, { label: string }> = {
  INSPECCION:  { label: 'Inspección' },
  USO:         { label: 'Uso del equipo' },
  LIMPIEZA:    { label: 'Limpieza' },
  LUBRICACION: { label: 'Lubricación' },
  REVISION:    { label: 'Revisión técnica' },
  REPARACION:  { label: 'Reparación' },
  PRUEBA:      { label: 'Prueba de funcionamiento' },
  OTRO:        { label: 'Otra' },
}
/** Actividades que puede registrar el personal de sede (el resto son de técnico). */
export const ACTIVIDADES_SEDE = ['INSPECCION', 'USO', 'LIMPIEZA', 'PRUEBA', 'OTRO'] as const
export const ACTIVIDADES_TECNICO = ['REVISION', 'LUBRICACION', 'REPARACION', 'PRUEBA', 'LIMPIEZA', 'INSPECCION', 'OTRO'] as const

/** Checklist base de la inspección de un equipo. */
export const CHECKLIST_INSPECCION = [
  'Enciende y funciona normalmente',
  'Cable y enchufe sin daños',
  'Sin ruidos ni olores extraños',
  'Carcasa y accesorios completos',
  'Limpio y guardado correctamente',
]

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONA_HORARIA })

export function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const MAX_ADJUNTO_BYTES = 25 * 1024 * 1024

/**
 * Sube un archivo al bucket privado `mantenimiento` bajo la carpeta del equipo.
 * Devuelve la RUTA (no URL): para mostrarlo se firma con `firmarRutas`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function subirArchivoMant(sb: any, maquinariaId: string, carpeta: string, file: File): Promise<string> {
  if (file.size > MAX_ADJUNTO_BYTES) throw new Error(`"${file.name}" supera 25 MB.`)
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
  const path = `${maquinariaId}/${carpeta}/${id}.${ext}`
  const { error } = await sb.storage.from(BUCKET_MANT).upload(path, file, {
    upsert: false, contentType: file.type || 'application/octet-stream',
  })
  if (error) throw new Error(error.message)
  return path
}

/** Firma varias rutas del bucket de una vez. Devuelve { ruta: url }. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function firmarRutas(sb: any, rutas: string[], segundos = 3600): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))]
  if (unicas.length === 0) return {}
  const { data } = await sb.storage.from(BUCKET_MANT).createSignedUrls(unicas, segundos)
  const out: Record<string, string> = {}
  for (const d of (data ?? []) as { path: string | null; signedUrl: string }[]) {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  }
  return out
}

/**
 * Qué se escaneó cuando se abre una orden de trabajo en sitio.
 *
 * Hay DOS clases de placa en este sistema y se confunden fácil, que es
 * exactamente el error que tenía F7:
 *   · la del equipo propio de la empresa abre `/equipo/<ref>` y lo que lleva
 *     dentro es el CÓDIGO del equipo (`MAQ-0012`);
 *   · la de un punto de control o de un activo del cliente abre `/q/<token>` y
 *     lo que lleva es un TOKEN FIRMADO de 21 caracteres (o, impreso debajo, el
 *     código manual de 8 que se teclea de noche).
 *
 * Una orden de trabajo se ejecuta sobre un activo, así que lo que vale es la
 * segunda. Pasarle la URL entera a la base no encuentra nada —`ronda_qr` se
 * busca por token EXACTO— y el técnico recibía «esa placa no está registrada»
 * con una placa perfectamente buena, empujado a la apertura manual, que es
 * justo la distinción que el estado `EN_SITIO` existe para proteger.
 *
 * El trabajo de sacar el código de la URL ya lo hace `codigoDeEscaneo` de
 * `packages/ronda-core` (la comparten esta app y la móvil), así que aquí NO se
 * reimplementa: solo se decide cuál de las dos clases es, para poder decir qué
 * pasó cuando alguien escanea la placa equivocada.
 */
export type EscaneoOT =
  | { tipo: 'QR'; codigo: string; modo: 'QR' | 'MANUAL' }
  | { tipo: 'EQUIPO'; referencia: string }
  | { tipo: 'DESCONOCIDO'; crudo: string }

export function clasificarEscaneoOT(valor: string): EscaneoOT {
  const v = (valor ?? '').trim()

  // ¿Es la placa de un equipo propio? Se mira ANTES de normalizar, porque
  // normalizar le quita las barras a la URL y ya no se sabría.
  try {
    const partes = new URL(v).pathname.split('/').filter(Boolean)
    const i = partes.findIndex((p) => p === 'equipo' || p === 'maquinaria')
    if (i >= 0 && partes[i + 1]) {
      return { tipo: 'EQUIPO', referencia: decodeURIComponent(partes[i + 1]) }
    }
  } catch { /* no es URL: sigue */ }

  const c = codigoDeEscaneo(v)
  const clase = clasificarEntrada(c)
  if (clase.tipo === 'TOKEN')  return { tipo: 'QR', codigo: clase.codigo, modo: 'QR' }
  if (clase.tipo === 'MANUAL') return { tipo: 'QR', codigo: clase.codigo, modo: 'MANUAL' }
  return { tipo: 'DESCONOCIDO', crudo: v }
}

/** Lo que devuelve un QR o lo que alguien digita → referencia del equipo.
 *  Solo para la placa de un equipo PROPIO (`/equipo/<ref>`): para la de un
 *  punto o un activo hay que usar `clasificarEscaneoOT`. */
export function extraerReferenciaEquipo(valor: string): string {
  const v = valor.trim()
  try {
    const u = new URL(v)
    const partes = u.pathname.split('/').filter(Boolean)
    const i = partes.findIndex((p) => p === 'equipo' || p === 'maquinaria')
    if (i >= 0 && partes[i + 1]) return decodeURIComponent(partes[i + 1])
  } catch { /* no es URL: es el código escrito */ }
  return v
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
