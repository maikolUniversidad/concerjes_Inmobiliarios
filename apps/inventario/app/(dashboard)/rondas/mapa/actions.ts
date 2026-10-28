'use server'

// Refresco del mapa y carga del recorrido, desde el cliente.
//
// Van como server actions y no como consultas desde el navegador por una razón
// concreta de R2: la antigüedad de cada posición la calcula el SERVIDOR, y si
// el navegador leyera `persona_ubicacion_actual` por su cuenta tendría que
// restar con su propio reloj — que es exactamente lo que R2 prohíbe. Aquí
// vuelve a llamarse a `ronda_mapa_personas()`, que recalcula la antigüedad en
// el momento de la lectura.

import { faltaPermiso } from '@/lib/permisos-server'
import {
  getPersonasEnMapa, getPersonasSinUbicacion, getRecorrido,
  type PersonaEnMapa, type PersonaSinUbicacion, type PuntoRecorridoFila,
} from './datos'

export interface RefrescoMapa {
  error?: string
  personas?: PersonaEnMapa[]
  sinUbicacion?: PersonaSinUbicacion[]
  /** Hora del servidor en la que se tomó la foto, para rotular «al día de». */
  consultadoAt?: string
}

export async function refrescarMapa(grupo?: string, sede?: string): Promise<RefrescoMapa> {
  const falta = await faltaPermiso('ver_mapa_operativo', 'ver_recorrido_personas')
  if (falta) return { error: falta }
  try {
    const [personas, sinUbicacion] = await Promise.all([
      getPersonasEnMapa(grupo, sede),
      getPersonasSinUbicacion(grupo, sede),
    ])
    return { personas, sinUbicacion, consultadoAt: new Date().toISOString() }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo actualizar el mapa.' }
  }
}

export interface RespuestaRecorrido {
  error?: string
  puntos?: PuntoRecorridoFila[]
}

export async function cargarRecorrido(turno: string): Promise<RespuestaRecorrido> {
  // Clave propia y más restrictiva que la del mapa: reproducir los pasos de una
  // persona es tratamiento de datos de desempeño (§10.3). La función de la base
  // lo vuelve a exigir, así que esto es solo para dar un mensaje legible.
  const falta = await faltaPermiso('ver_recorrido_personas')
  if (falta) return { error: falta }
  try {
    return { puntos: await getRecorrido(turno, 500) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo cargar el recorrido.' }
  }
}
