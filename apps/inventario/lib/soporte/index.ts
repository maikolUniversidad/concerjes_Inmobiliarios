// Catálogos, tipos y utilidades del módulo de Soporte (botón de bug).
// Las reglas de estados viven en la BD (RPC `soporte_*`); aquí solo lo visual.
import type { ContextoSoporte } from './captura'

export const BUCKET_SOPORTE = 'soporte'

// Zona fija: el servidor (UTC en Vercel) y el navegador deben formatear igual
// o React falla al hidratar.
export const ZONA_SOPORTE = 'America/Bogota'
export const fechaHoraSoporte = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONA_SOPORTE })
export const horaCortaSoporte = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ZONA_SOPORTE })

/** "Estado: EN_PROCESO → RESUELTO" → "Estado: En proceso → Resuelto". */
export function legibleEstados(texto: string): string {
  return texto.replace(/\b(ABIERTO|EN_PROCESO|EN_ESPERA|RESUELTO|CERRADO|CANCELADO)\b/g,
    (e) => ESTADO_SOPORTE_META[e as EstadoSoporte]?.label ?? e)
}
export const MAX_ADJUNTO_SOPORTE = 50 * 1024 * 1024

export type TipoSoporte = 'ERROR' | 'SOPORTE' | 'MEJORA'
export type EstadoSoporte = 'ABIERTO' | 'EN_PROCESO' | 'EN_ESPERA' | 'RESUELTO' | 'CERRADO' | 'CANCELADO'

export const TIPO_SOPORTE_META: Record<TipoSoporte, { label: string; desc: string; cls: string }> = {
  ERROR:   { label: 'Error',             desc: 'Algo no funciona o sale un error', cls: 'bg-red-100 text-red-700' },
  SOPORTE: { label: 'Soporte',           desc: 'Necesito ayuda o no sé cómo hacerlo', cls: 'bg-sky-100 text-sky-700' },
  MEJORA:  { label: 'Propuesta de mejora', desc: 'Una idea para que funcione mejor', cls: 'bg-violet-100 text-violet-700' },
}

export const ESTADO_SOPORTE_META: Record<EstadoSoporte, { label: string; cls: string; dot: string }> = {
  ABIERTO:    { label: 'Abierto',    cls: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  EN_ESPERA:  { label: 'En espera',  cls: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500' },
  RESUELTO:   { label: 'Resuelto',   cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  CERRADO:    { label: 'Cerrado',    cls: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400' },
  CANCELADO:  { label: 'Cancelado',  cls: 'bg-gray-100 text-gray-400 line-through', dot: 'bg-gray-300' },
}
export const ESTADOS_SOPORTE = Object.keys(ESTADO_SOPORTE_META) as EstadoSoporte[]
export const ESTADOS_SOPORTE_ACTIVOS: EstadoSoporte[] = ['ABIERTO', 'EN_PROCESO', 'EN_ESPERA', 'RESUELTO']

export const PRIORIDAD_SOPORTE_META: Record<string, { label: string; cls: string; orden: number }> = {
  CRITICA: { label: 'Crítica', cls: 'bg-red-600 text-white',          orden: 0 },
  ALTA:    { label: 'Alta',    cls: 'bg-orange-100 text-orange-700',  orden: 1 },
  MEDIA:   { label: 'Media',   cls: 'bg-yellow-100 text-yellow-700',  orden: 2 },
  BAJA:    { label: 'Baja',    cls: 'bg-gray-100 text-gray-600',      orden: 3 },
}
export const PRIORIDADES_SOPORTE = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const

/** Contexto guardado: lo del navegador + el usuario que agrega la BD. */
export type ContextoGuardado = Partial<ContextoSoporte> & {
  usuario?: { id?: string; nombre?: string; email?: string; rol?: string; rol_nombre?: string | null; sede?: string | null }
}

export interface SoporteTicket {
  id: string
  numero: string
  tipo: TipoSoporte
  prioridad: string
  estado: EstadoSoporte
  titulo: string
  descripcion: string | null
  ruta: string | null
  modulo: string | null
  contexto: ContextoGuardado
  captura_path: string | null
  reportado_por: string | null
  reportado_nombre: string | null
  reportado_email: string | null
  asignado_a: string | null
  asignado_nombre: string | null
  solucion: string | null
  resuelto_at: string | null
  cerrado_at: string | null
  ultimo_mensaje_at: string | null
  created_at: string
  updated_at: string
}

export interface SoporteMensaje {
  id: string
  ticket_id: string
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
  created_at: string
}

export const SELECT_MENSAJE =
  'id, ticket_id, usuario_id, usuario_nombre, tipo, mensaje, estado_anterior, estado_nuevo, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes, created_at'

export interface AdjuntoSubido { path: string; nombre: string; mime: string | null; bytes: number }

/**
 * Acciones que puede hacer cada quien según el estado (la BD lo vuelve a
 * validar). `comentario` = la BD exige comentario para ese paso.
 */
export function accionesDisponibles(estado: EstadoSoporte, agente: boolean, esAutor: boolean):
  { estado: EstadoSoporte; label: string; comentario: boolean; evidencia: boolean }[] {
  if (agente) {
    const todas: Record<EstadoSoporte, { label: string; comentario: boolean; evidencia: boolean }> = {
      ABIERTO:    { label: 'Reabrir',                comentario: false, evidencia: false },
      EN_PROCESO: { label: 'Tomar / en proceso',     comentario: false, evidencia: false },
      EN_ESPERA:  { label: 'En espera (falta info)', comentario: false, evidencia: false },
      RESUELTO:   { label: 'Marcar resuelto',        comentario: true,  evidencia: true },
      CERRADO:    { label: 'Cerrar',                 comentario: true,  evidencia: true },
      CANCELADO:  { label: 'Cancelar',               comentario: true,  evidencia: false },
    }
    return ESTADOS_SOPORTE.filter((e) => e !== estado).map((e) => ({ estado: e, ...todas[e] }))
  }
  if (!esAutor) return []
  if (estado === 'ABIERTO') return [{ estado: 'CANCELADO', label: 'Cancelar mi ticket', comentario: true, evidencia: false }]
  if (estado === 'RESUELTO') return [
    { estado: 'CERRADO', label: 'Confirmar solución y cerrar', comentario: true, evidencia: true },
    { estado: 'ABIERTO', label: 'Sigue fallando: reabrir', comentario: true, evidencia: true },
  ]
  if (estado === 'CERRADO') return [{ estado: 'ABIERTO', label: 'Reabrir', comentario: true, evidencia: true }]
  return []
}

/** Sube un archivo a `soporte/{ticketId}/…` y devuelve su ruta (no URL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function subirArchivoSoporte(sb: any, ticketId: string, file: Blob, nombre: string): Promise<AdjuntoSubido> {
  if (file.size > MAX_ADJUNTO_SOPORTE) throw new Error(`"${nombre}" supera 50 MB.`)
  const ext = (nombre.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
  const path = `${ticketId}/${id}.${ext}`
  const { error } = await sb.storage.from(BUCKET_SOPORTE).upload(path, file, {
    upsert: false, contentType: file.type || 'application/octet-stream',
  })
  if (error) throw new Error(error.message)
  return { path, nombre: nombre.slice(0, 255), mime: file.type || null, bytes: file.size }
}

/** Firma varias rutas del bucket de una vez. Devuelve { ruta: url }. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function firmarRutasSoporte(sb: any, rutas: string[], segundos = 3600): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))]
  if (unicas.length === 0) return {}
  const { data } = await sb.storage.from(BUCKET_SOPORTE).createSignedUrls(unicas, segundos)
  const out: Record<string, string> = {}
  for (const d of (data ?? []) as { path: string | null; signedUrl: string }[]) {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  }
  return out
}

/** Copia texto al portapapeles (con plan B para navegadores sin la API). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** 3 h 20 min · 2 d 4 h · 45 s */
export function duracionLegible(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  const d = Math.floor(h / 24)
  return `${d} d${h % 24 ? ` ${h % 24} h` : ''}`
}

export interface FaseSoporte {
  estado: EstadoSoporte
  desde: string
  hasta: string | null
  /** Quién hizo el cambio que abrió esta fase. */
  por: string | null
  /** Mensaje de SISTEMA que abrió la fase (null si es la fase inicial sin mensaje). */
  mensajeId: string | null
  comentario: string | null
}

/**
 * Recorre el chat y arma las fases por estado (de qué a qué, quién, cuánto duró)
 * y el estado vigente cuando se escribió cada mensaje. Sirve para las etiquetas
 * del chat y para el prompt.
 */
export function fasesSoporte(mensajes: SoporteMensaje[], creado: string): {
  fases: FaseSoporte[]
  estadoDe: Record<string, EstadoSoporte>
  /** Mensaje de SISTEMA de la última resolución que sigue vigente (no se reabrió después). */
  solucionVigenteId: string | null
} {
  const fases: FaseSoporte[] = [{ estado: 'ABIERTO', desde: creado, hasta: null, por: null, mensajeId: null, comentario: null }]
  const estadoDe: Record<string, EstadoSoporte> = {}
  let solucionVigenteId: string | null = null
  for (const m of mensajes) {
    const nuevo = m.tipo === 'SISTEMA' ? (m.estado_nuevo as EstadoSoporte | null) : null
    const actual = fases[fases.length - 1]
    if (nuevo && ESTADO_SOPORTE_META[nuevo]) {
      const comentario = (m.mensaje ?? '').split('\n').slice(1).join('\n').trim() || null
      if (!m.estado_anterior && fases.length === 1 && !actual.mensajeId) {
        // Mensaje de creación: es la fase inicial.
        Object.assign(actual, { estado: nuevo, desde: m.created_at, por: m.usuario_nombre, mensajeId: m.id, comentario })
      } else if (nuevo !== actual.estado) {
        actual.hasta = m.created_at
        fases.push({ estado: nuevo, desde: m.created_at, hasta: null, por: m.usuario_nombre, mensajeId: m.id, comentario })
      }
      const ultima = fases[fases.length - 1]
      if (ultima.mensajeId === m.id) {
        // Solo cuenta un cambio real de estado (no "Actualización" de responsable o prioridad).
        if (nuevo === 'RESUELTO') solucionVigenteId = m.id
        else if (nuevo !== 'CERRADO') solucionVigenteId = null
      }
    }
    estadoDe[m.id] = fases[fases.length - 1].estado
  }
  return { fases, estadoDe, solucionVigenteId }
}
