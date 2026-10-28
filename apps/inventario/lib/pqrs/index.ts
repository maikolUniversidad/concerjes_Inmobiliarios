// Catálogos, tipos y utilidades del módulo de PQRS.
// Las reglas de estados y de plazos viven en la BD (RPC `pqrs_*`); aquí solo
// está lo visual y lo que ayuda a leer un plazo de un vistazo.

export const BUCKET_PQRS = 'pqrs'
export const MAX_ADJUNTO_PQRS = 50 * 1024 * 1024

// Zona fija: el servidor (UTC en Vercel) y el navegador deben formatear igual
// o React falla al hidratar.
export const ZONA_PQRS = 'America/Bogota'

export type TipoPqrs = 'PETICION' | 'QUEJA' | 'RECLAMO' | 'SUGERENCIA' | 'FELICITACION'
export type EstadoPqrs = 'RADICADA' | 'EN_TRAMITE' | 'EN_ESPERA' | 'RESPONDIDA' | 'CERRADA' | 'ANULADA'
export type CanalPqrs = 'SEDE' | 'TELEFONO' | 'CORREO' | 'WHATSAPP' | 'PORTAL' | 'QR' | 'OTRO'
export type CalidadPqrs =
  | 'RESIDENTE' | 'PROPIETARIO' | 'ADMINISTRACION' | 'EMPRESA_USUARIA' | 'COLABORADOR' | 'PROVEEDOR' | 'OTRO'

export const TIPO_PQRS_META: Record<TipoPqrs, { label: string; desc: string; cls: string }> = {
  PETICION:     { label: 'Petición',     desc: 'Pide un servicio, una gestión o información', cls: 'bg-sky-100 text-sky-700' },
  QUEJA:        { label: 'Queja',        desc: 'Inconformidad con la atención o el servicio',  cls: 'bg-amber-100 text-amber-700' },
  RECLAMO:      { label: 'Reclamo',      desc: 'Exige por un incumplimiento o un daño',        cls: 'bg-red-100 text-red-700' },
  SUGERENCIA:   { label: 'Sugerencia',   desc: 'Propone cómo mejorar el servicio',             cls: 'bg-violet-100 text-violet-700' },
  FELICITACION: { label: 'Felicitación', desc: 'Reconoce el servicio o a quien lo prestó',     cls: 'bg-emerald-100 text-emerald-700' },
}
export const TIPOS_PQRS = Object.keys(TIPO_PQRS_META) as TipoPqrs[]

export const ESTADO_PQRS_META: Record<EstadoPqrs, { label: string; cls: string; dot: string }> = {
  RADICADA:   { label: 'Radicada',   cls: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
  EN_TRAMITE: { label: 'En trámite', cls: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  EN_ESPERA:  { label: 'En espera',  cls: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500' },
  RESPONDIDA: { label: 'Respondida', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  CERRADA:    { label: 'Cerrada',    cls: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400' },
  ANULADA:    { label: 'Anulada',    cls: 'bg-gray-100 text-gray-400 line-through', dot: 'bg-gray-300' },
}
export const ESTADOS_PQRS = Object.keys(ESTADO_PQRS_META) as EstadoPqrs[]
/** Siguen consumiendo plazo: son las que hay que trabajar. */
export const ESTADOS_PQRS_ABIERTAS: EstadoPqrs[] = ['RADICADA', 'EN_TRAMITE', 'EN_ESPERA']
/** Activas = abiertas + las respondidas que aún esperan conformidad. */
export const ESTADOS_PQRS_ACTIVAS: EstadoPqrs[] = [...ESTADOS_PQRS_ABIERTAS, 'RESPONDIDA']

export const PRIORIDAD_PQRS_META: Record<string, { label: string; cls: string; orden: number }> = {
  CRITICA: { label: 'Crítica', cls: 'bg-red-600 text-white',          orden: 0 },
  ALTA:    { label: 'Alta',    cls: 'bg-orange-100 text-orange-700',  orden: 1 },
  MEDIA:   { label: 'Media',   cls: 'bg-yellow-100 text-yellow-700',  orden: 2 },
  BAJA:    { label: 'Baja',    cls: 'bg-gray-100 text-gray-600',      orden: 3 },
}
export const PRIORIDADES_PQRS = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const

export const CANAL_PQRS_META: Record<CanalPqrs, { label: string }> = {
  SEDE:     { label: 'En la sede' },
  TELEFONO: { label: 'Teléfono' },
  CORREO:   { label: 'Correo' },
  WHATSAPP: { label: 'WhatsApp' },
  PORTAL:   { label: 'Portal del cliente' },
  // F5: la radicó un residente escaneando la placa de un punto de control.
  QR:       { label: 'QR del punto' },
  OTRO:     { label: 'Otro' },
}
export const CANALES_PQRS = Object.keys(CANAL_PQRS_META) as CanalPqrs[]
/** Los que se pueden elegir al radicar DESDE LA CONSOLA. `QR` no está: ese
 *  canal lo pone `pqrs_radicar_publica()` cuando alguien escanea una placa, y
 *  la base exige que una PQRS con canal `QR` lleve punto (F5). */
export const CANALES_PQRS_CONSOLA = CANALES_PQRS.filter((c) => c !== 'QR')

export const CALIDAD_PQRS_META: Record<CalidadPqrs, { label: string }> = {
  RESIDENTE:       { label: 'Residente' },
  PROPIETARIO:     { label: 'Propietario' },
  ADMINISTRACION:  { label: 'Administración' },
  EMPRESA_USUARIA: { label: 'Empresa usuaria' },
  COLABORADOR:     { label: 'Colaborador' },
  PROVEEDOR:       { label: 'Proveedor' },
  OTRO:            { label: 'Otro' },
}
export const CALIDADES_PQRS = Object.keys(CALIDAD_PQRS_META) as CalidadPqrs[]

export interface Pqrs {
  id: string
  numero: string
  tipo: TipoPqrs
  canal: CanalPqrs
  estado: EstadoPqrs
  prioridad: string
  anonima: boolean
  solicitante_nombre: string | null
  solicitante_calidad: CalidadPqrs
  solicitante_doc: string | null
  solicitante_telefono: string | null
  solicitante_email: string | null
  sede_id: string
  sede_nombre: string | null
  grupo_id: string | null
  persona_id: string | null
  persona_nombre: string | null
  // Puntos QR (F5). Van con nombre desnormalizado porque quien atiende la PQRS
  // puede no tener `ver_puntos_ronda` y la RLS no le dejaría leer el punto.
  punto_id: string | null
  punto_nombre: string | null
  zona_id: string | null
  qr_id: string | null
  categoria_id: string | null
  categoria_nombre: string | null
  satisfaccion: number | null
  satisfaccion_at: string | null
  asunto: string
  descripcion: string
  responsable_id: string | null
  responsable_nombre: string | null
  dias_plazo: number
  fecha_limite: string
  respuesta: string | null
  respondida_at: string | null
  respondida_por: string | null
  respondida_nombre: string | null
  cerrada_at: string | null
  radicada_por: string | null
  radicada_nombre: string | null
  ultimo_mensaje_at: string | null
  created_at: string
  updated_at: string
}

/** Lo que necesita el listado (sin `descripcion`, que puede ser larga). */
export type PqrsFila = Omit<Pqrs, 'descripcion' | 'respuesta'>

export const SELECT_PQRS_LISTA =
  'id, numero, tipo, canal, estado, prioridad, anonima, solicitante_nombre, solicitante_calidad, ' +
  'solicitante_doc, solicitante_telefono, solicitante_email, sede_id, sede_nombre, grupo_id, persona_id, ' +
  'persona_nombre, punto_id, punto_nombre, categoria_id, categoria_nombre, ' +
  'asunto, responsable_id, responsable_nombre, dias_plazo, fecha_limite, respondida_at, respondida_por, ' +
  'respondida_nombre, cerrada_at, radicada_por, radicada_nombre, ultimo_mensaje_at, created_at, updated_at'

export interface PqrsMensaje {
  id: string
  pqrs_id: string
  usuario_id: string | null
  usuario_nombre: string | null
  tipo: 'MENSAJE' | 'ADJUNTO' | 'SISTEMA'
  mensaje: string | null
  estado_anterior: string | null
  estado_nuevo: string | null
  adjunto_path: string | null
  adjunto_nombre: string | null
  adjunto_mime: string | null
  adjunto_bytes: number | null
  /** F5: por dónde entró o salió el mensaje, y hacia dónde. La consola escribe
   *  PLATAFORMA/SALIDA; el QR, el correo y WhatsApp llenan los otros. */
  canal: 'PLATAFORMA' | 'CORREO' | 'WHATSAPP' | 'QR'
  direccion: 'ENTRADA' | 'SALIDA'
  created_at: string
}

export const SELECT_PQRS_BITACORA =
  'id, pqrs_id, usuario_id, usuario_nombre, tipo, mensaje, estado_anterior, estado_nuevo, ' +
  'adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes, canal, direccion, created_at'

export interface AdjuntoPqrs { path: string; nombre: string; mime: string | null; bytes: number }

export interface SedePqrs { id: string; nombre: string; codigo_interno: string | null; zona: string | null; ciudad: string | null }

/** Categoría del catálogo de PQRS (F5). `grupo_id` nulo = aplica a todos los
 *  contratos; una del contrato con el mismo `codigo` la reemplaza. */
export interface CategoriaPqrs {
  id: string
  grupo_id: string | null
  codigo: string
  nombre: string
  descripcion: string | null
  tipo_sugerido: TipoPqrs
  prioridad_sugerida: string
  orden: number
  activo: boolean
  created_at: string
  updated_at: string
}

export const SELECT_PQRS_CATEGORIAS =
  'id, grupo_id, codigo, nombre, descripcion, tipo_sugerido, prioridad_sugerida, orden, activo, created_at, updated_at'
export interface GestorPqrs { id: string; nombre: string; rol_nombre: string | null }

// ── Fechas y plazos ─────────────────────────────────────────────────────────

export const fechaHoraPqrs = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONA_PQRS })
export const horaCortaPqrs = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ZONA_PQRS })

/** "2026-10-18" → "18/10/2026". Sin `new Date`, para no correr el día por zona. */
export function fechaCorta(fecha: string | null): string {
  if (!fecha) return '—'
  const [a, m, d] = fecha.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : fecha
}

/**
 * Hoy en Bogotá como "YYYY-MM-DD". Servidor (UTC) y navegador dan lo mismo, así
 * que los semáforos de vencimiento no rompen la hidratación.
 */
export function hoyBogota(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_PQRS })
}

const DIA_MS = 86_400_000
/** Días de calendario entre dos fechas "YYYY-MM-DD" (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DIA_MS)
}

export type Semaforo = 'VENCIDA' | 'HOY' | 'PRONTO' | 'EN_PLAZO' | 'CERRADA'

export interface EstadoPlazo {
  semaforo: Semaforo
  /** Días de calendario que faltan (negativo = días de atraso). */
  dias: number
  texto: string
  cls: string
}

/**
 * Cómo va el plazo de una PQRS. Las que ya no consumen plazo (respondida,
 * cerrada, anulada) no se pintan en rojo aunque la fecha haya pasado.
 */
export function estadoPlazo(fechaLimite: string, estado: EstadoPqrs, hoy = hoyBogota()): EstadoPlazo {
  if (!ESTADOS_PQRS_ABIERTAS.includes(estado)) {
    return { semaforo: 'CERRADA', dias: 0, texto: fechaCorta(fechaLimite), cls: 'text-gray-400' }
  }
  const dias = diasEntre(hoy, fechaLimite)
  if (dias < 0) return { semaforo: 'VENCIDA', dias, texto: `Vencida hace ${Math.abs(dias)} d`, cls: 'text-red-700 font-semibold' }
  if (dias === 0) return { semaforo: 'HOY', dias, texto: 'Vence hoy', cls: 'text-red-600 font-semibold' }
  if (dias <= 3) return { semaforo: 'PRONTO', dias, texto: `Vence en ${dias} d`, cls: 'text-amber-700 font-semibold' }
  return { semaforo: 'EN_PLAZO', dias, texto: `${fechaCorta(fechaLimite)} · ${dias} d`, cls: 'text-gray-600' }
}

/** Nombre a mostrar de quien radicó (respetando el anonimato). */
export function solicitante(p: { anonima: boolean; solicitante_nombre: string | null; solicitante_calidad: CalidadPqrs }): string {
  if (p.anonima) return 'Anónima'
  const calidad = CALIDAD_PQRS_META[p.solicitante_calidad]?.label
  return p.solicitante_nombre ? (calidad ? `${p.solicitante_nombre} (${calidad})` : p.solicitante_nombre) : '—'
}

/** "Estado: EN_TRAMITE → CERRADA" → "Estado: En trámite → Cerrada". */
export function legibleEstadosPqrs(texto: string): string {
  return texto.replace(/\b(RADICADA|EN_TRAMITE|EN_ESPERA|RESPONDIDA|CERRADA|ANULADA)\b/g,
    (e) => ESTADO_PQRS_META[e as EstadoPqrs]?.label ?? e)
}

// ── Acciones disponibles ────────────────────────────────────────────────────

export interface AccionPqrs {
  estado: EstadoPqrs
  label: string
  /** La BD exige comentario para este paso. */
  comentario: boolean
  evidencia: boolean
}

/**
 * Qué puede hacer cada quien según el estado (la BD lo vuelve a validar).
 * Fuera de coordinación, lo único posible es anular lo que uno mismo radicó
 * por error y que nadie ha tomado todavía.
 */
export function accionesPqrs(estado: EstadoPqrs, coordina: boolean, esRadicador: boolean): AccionPqrs[] {
  if (coordina) {
    const todas: Record<EstadoPqrs, { label: string; comentario: boolean; evidencia: boolean }> = {
      RADICADA:   { label: 'Devolver a radicada',  comentario: false, evidencia: false },
      EN_TRAMITE: { label: 'Tomar / en trámite',   comentario: false, evidencia: false },
      EN_ESPERA:  { label: 'En espera de un tercero', comentario: false, evidencia: false },
      RESPONDIDA: { label: 'Registrar respuesta',  comentario: true,  evidencia: true },
      CERRADA:    { label: 'Cerrar',               comentario: true,  evidencia: true },
      ANULADA:    { label: 'Anular',               comentario: true,  evidencia: false },
    }
    return ESTADOS_PQRS
      .filter((e) => e !== estado)
      // Reabrir una respondida/cerrada exige explicar por qué.
      .map((e) => ({
        estado: e,
        ...todas[e],
        comentario: todas[e].comentario
          || (['RADICADA', 'EN_TRAMITE'].includes(e) && ['RESPONDIDA', 'CERRADA'].includes(estado)),
      }))
  }
  if (esRadicador && estado === 'RADICADA') {
    return [{ estado: 'ANULADA', label: 'Anular: la radiqué por error', comentario: true, evidencia: false }]
  }
  return []
}

// ── Evidencia en el bucket privado ──────────────────────────────────────────

/** Sube un archivo a `pqrs/{pqrsId}/…` y devuelve su ruta (no URL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function subirArchivoPqrs(sb: any, pqrsId: string, file: Blob, nombre: string): Promise<AdjuntoPqrs> {
  if (file.size > MAX_ADJUNTO_PQRS) throw new Error(`"${nombre}" supera 50 MB.`)
  const ext = (nombre.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
  const path = `${pqrsId}/${id}.${ext}`
  const { error } = await sb.storage.from(BUCKET_PQRS).upload(path, file, {
    upsert: false, contentType: file.type || 'application/octet-stream',
  })
  if (error) throw new Error(error.message)
  return { path, nombre: nombre.slice(0, 255), mime: file.type || null, bytes: file.size }
}

/** Firma varias rutas del bucket de una vez. Devuelve { ruta: url }. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function firmarRutasPqrs(sb: any, rutas: string[], segundos = 3600): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))]
  if (unicas.length === 0) return {}
  const { data } = await sb.storage.from(BUCKET_PQRS).createSignedUrls(unicas, segundos)
  const out: Record<string, string> = {}
  for (const d of (data ?? []) as { path: string | null; signedUrl: string }[]) {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  }
  return out
}

// ── Indicadores del listado ─────────────────────────────────────────────────

export interface IndicadoresPqrs {
  radicadas: number
  enTramite: number
  porCerrar: number
  vencidas: number
  porVencer: number
  /** Días de calendario promedio entre radicar y responder (solo respondidas). */
  diasPromedioRespuesta: number | null
  /** Cumplimiento: % de respondidas que se respondieron dentro del plazo. */
  cumplimiento: number | null
  topSedes: { nombre: string; n: number }[]
  porTipo: { tipo: TipoPqrs; n: number }[]
}

export function indicadoresPqrs(filas: PqrsFila[], hoy = hoyBogota()): IndicadoresPqrs {
  const abiertas = filas.filter((p) => ESTADOS_PQRS_ABIERTAS.includes(p.estado))
  const plazos = abiertas.map((p) => estadoPlazo(p.fecha_limite, p.estado, hoy))
  const respondidas = filas.filter((p) => p.respondida_at)

  const dias = respondidas.map((p) => diasEntre(p.created_at.slice(0, 10), p.respondida_at!.slice(0, 10)))
  const aTiempo = respondidas.filter((p) => p.respondida_at!.slice(0, 10) <= p.fecha_limite.slice(0, 10)).length

  const porSede = new Map<string, number>()
  for (const p of filas) {
    if (p.estado === 'ANULADA') continue
    const k = p.sede_nombre ?? '—'
    porSede.set(k, (porSede.get(k) ?? 0) + 1)
  }

  return {
    radicadas: filas.filter((p) => p.estado === 'RADICADA').length,
    enTramite: filas.filter((p) => p.estado === 'EN_TRAMITE' || p.estado === 'EN_ESPERA').length,
    porCerrar: filas.filter((p) => p.estado === 'RESPONDIDA').length,
    vencidas: plazos.filter((x) => x.semaforo === 'VENCIDA').length,
    porVencer: plazos.filter((x) => x.semaforo === 'HOY' || x.semaforo === 'PRONTO').length,
    diasPromedioRespuesta: dias.length ? Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10 : null,
    cumplimiento: respondidas.length ? Math.round((aTiempo / respondidas.length) * 100) : null,
    topSedes: [...porSede.entries()]
      .map(([nombre, n]) => ({ nombre, n }))
      .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre))
      .slice(0, 5),
    porTipo: TIPOS_PQRS
      .map((tipo) => ({ tipo, n: filas.filter((p) => p.tipo === tipo && p.estado !== 'ANULADA').length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n),
  }
}
