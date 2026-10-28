import 'server-only'

// Lo que el mapa operativo lee de la base (F8, §4.3 del complemento 2).
//
// Todo pasa por las funciones de la migración y NO por consultas armadas aquí.
// No es ceremonia: `ronda_mapa_personas()` es la que cumple R2 —devuelve la
// antigüedad calculada en el SERVIDOR, la fuente y si la posición está dentro
// de la ventana de frescura del contrato—, y es la que cumple R1 en la lectura
// —solo personas con turno abierto y vigente—. Una consulta a
// `persona_ubicacion_actual` desde aquí se saltaría las dos cosas.
//
// Y ninguna de estas lecturas toca `persona_ubicacion_historial` salvo el
// replay, que pide UN turno: el corte de 8 s de Supabase está justo ahí.

import { createClient } from '@/lib/supabase/server'
import type { FuenteUbicacion } from '@/components/logistica/MapaLeaflet'

/** Cliente con `rpc` tipado laxo: los tipos generados no conocen las funciones
 *  nuevas (mismo motivo que `lib/campo/rpc.ts`). */
async function sb() {
  const cliente = await createClient()
  return cliente as unknown as {
    rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
    from(t: string): any // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

export interface PersonaEnMapa {
  persona_id: string
  persona_nombre: string
  turno_id: string
  grupo_id: string
  grupo_nombre: string | null
  sede_id: string | null
  sede_nombre: string | null
  ruta_id: string | null
  ruta_codigo: string | null
  punto_id: string | null
  punto_nombre: string | null
  lat: number
  lng: number
  precision_metros: number | null
  velocidad_kmh: number | null
  rumbo: number | null
  fuente: FuenteUbicacion
  capturado_at: string
  /** R2: segundos desde la captura, calculados en el servidor. */
  antiguedad_seg: number
  frescura_seg: number
  en_vivo: boolean
  turno_inicio_at: string
  turno_fin_previsto_at: string
  puntos_registrados: number
  metros_recorridos: number
}

export interface PersonaSinUbicacion {
  persona_id: string
  persona_nombre: string
  turno_id: string
  grupo_id: string
  sede_id: string | null
  sede_nombre: string | null
  turno_inicio_at: string
}

export interface SedeMapa {
  id: string
  nombre: string
  grupo_id: string | null
  lat: number | null
  lng: number | null
  direccion: string | null
}

export interface PuntoControlMapa {
  id: string
  codigo: string
  nombre: string
  sede_id: string
  grupo_id: string
  piso: string | null
  lat: number | null
  lng: number | null
  geocerca_metros: number
  estado: string
}

export interface TurnoRecorrible {
  turno_id: string
  persona_id: string
  persona_nombre: string
  grupo_id: string
  sede_id: string | null
  sede_nombre: string | null
  inicio_at: string
  fin_at: string | null
  fin_previsto_at: string
  estado: string
  puntos_registrados: number
  metros_recorridos: number
  ruta_codigo: string | null
}

export interface PuntoRecorridoFila {
  orden: number
  lat: number
  lng: number
  precision_metros: number | null
  velocidad_kmh: number | null
  fuente: FuenteUbicacion
  capturado_at: string
  metros_desde_anterior: number | null
  punto_id: string | null
  punto_nombre: string | null
  visita_id: string | null
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))

export async function getPersonasEnMapa(grupo?: string, sede?: string): Promise<PersonaEnMapa[]> {
  const c = await sb()
  const { data, error } = await c.rpc('ronda_mapa_personas', {
    p_grupo: grupo ?? null, p_sede: sede ?? null,
  })
  if (error) throw new Error(error.message)
  // Los `numeric` de Postgres llegan como texto por PostgREST: a número aquí,
  // porque Leaflet con una latitud en texto dibuja en el golfo de Guinea.
  return ((data ?? []) as PersonaEnMapa[]).map((p) => ({
    ...p,
    lat: num(p.lat), lng: num(p.lng),
    precision_metros: p.precision_metros == null ? null : num(p.precision_metros),
    velocidad_kmh: p.velocidad_kmh == null ? null : num(p.velocidad_kmh),
    rumbo: p.rumbo == null ? null : num(p.rumbo),
    antiguedad_seg: num(p.antiguedad_seg),
    frescura_seg: num(p.frescura_seg),
    puntos_registrados: num(p.puntos_registrados),
    metros_recorridos: num(p.metros_recorridos),
  }))
}

export async function getPersonasSinUbicacion(grupo?: string, sede?: string): Promise<PersonaSinUbicacion[]> {
  const c = await sb()
  const { data, error } = await c.rpc('ronda_mapa_sin_ubicacion', {
    p_grupo: grupo ?? null, p_sede: sede ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as PersonaSinUbicacion[]
}

export async function getTurnosRecorribles(grupo?: string, sede?: string): Promise<TurnoRecorrible[]> {
  const c = await sb()
  const { data, error } = await c.rpc('ronda_turnos_recorribles', {
    p_grupo: grupo ?? null, p_sede: sede ?? null,
    p_desde: null, p_hasta: null, p_limite: 100,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as TurnoRecorrible[]).map((t) => ({
    ...t,
    puntos_registrados: num(t.puntos_registrados),
    metros_recorridos: num(t.metros_recorridos),
  }))
}

export async function getRecorrido(turno: string, maxPuntos = 500): Promise<PuntoRecorridoFila[]> {
  const c = await sb()
  const { data, error } = await c.rpc('ronda_recorrido', {
    p_turno: turno, p_max_puntos: maxPuntos,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as PuntoRecorridoFila[]).map((p) => ({
    ...p,
    orden: num(p.orden), lat: num(p.lat), lng: num(p.lng),
    precision_metros: p.precision_metros == null ? null : num(p.precision_metros),
    velocidad_kmh: p.velocidad_kmh == null ? null : num(p.velocidad_kmh),
    metros_desde_anterior: p.metros_desde_anterior == null ? null : num(p.metros_desde_anterior),
  }))
}

/** Las sedes con coordenada del alcance del usuario. La RLS de `sedes` ya
 *  filtra; aquí solo se descarta la que no tiene dónde dibujarse. */
export async function getSedesMapa(): Promise<SedeMapa[]> {
  const c = await sb()
  const { data, error } = await c.from('sedes')
    .select('id, nombre, grupo_id, lat, lng, direccion')
    .not('lat', 'is', null).order('nombre').limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as SedeMapa[]).map((s) => ({
    ...s, lat: s.lat == null ? null : num(s.lat), lng: s.lng == null ? null : num(s.lng),
  }))
}

/** Los puntos de control con coordenada. Tope de 1.000: el mapa no es la
 *  pantalla de inventario de puntos, y traer todos los del país para dibujar
 *  una sede sería la consulta que se come los 8 s. */
export async function getPuntosControlMapa(sede?: string): Promise<PuntoControlMapa[]> {
  const c = await sb()
  let q = c.from('ronda_puntos')
    .select('id, codigo, nombre, sede_id, grupo_id, piso, lat, lng, geocerca_metros, estado')
    .not('lat', 'is', null).neq('estado', 'RETIRADO')
  if (sede) q = q.eq('sede_id', sede)
  const { data, error } = await q.order('sede_id').order('orden').order('codigo').limit(1000)
  if (error) throw new Error(error.message)
  return ((data ?? []) as PuntoControlMapa[]).map((p) => ({
    ...p,
    lat: p.lat == null ? null : num(p.lat), lng: p.lng == null ? null : num(p.lng),
    geocerca_metros: num(p.geocerca_metros),
  }))
}
