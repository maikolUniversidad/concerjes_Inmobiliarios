// La cola de la PWA: cómo salen de este celular la visita, sus archivos y su
// cierre (ADR-D).
//
// Hay DOS puentes al servidor, porque hay dos identidades:
//   · `cuenta`  — quien tiene usuario: llama las RPC con su sesión de Supabase
//     y sube los archivos DIRECTO al bucket con las políticas del ADR-C. El
//     binario no pasa por ninguna función;
//   · `sesion`  — quien entró con enlace + PIN: no tiene `auth.uid()`, así que
//     sus llamadas van por /api/campo/rpc y sus archivos por
//     /api/campo/medios, que validan la cookie firmada y llaman las MISMAS RPC
//     con la llave de servicio.
//
// Las dos usan el mismo outbox y la misma cola de medios de
// `@conserjes/offline`, y el mismo orden de intents de `@conserjes/ronda-core`:
// un solo camino de escritura (ADR-E).

'use client'

import {
  RPC_DE_INTENT, intentsDeVisita, type Actor, type VisitaLocal,
} from '@conserjes/ronda-core'
import {
  encolar, pushOutboxPorGrupo, subirMedios, resumenMedios,
  type MedioPendiente, type Sb,
} from '@conserjes/offline'
import { PushRegistry } from '@conserjes/offline'
import { createClient } from '@/lib/supabase/client'
import { almacen } from './idb'

export type ModoPuente = 'cuenta' | 'sesion'

export interface Puente {
  modo: ModoPuente
  /** Cliente estructural para el motor de `@conserjes/offline`. */
  sb: Sb
  subirMedio(m: MedioPendiente): Promise<string>
  urlFirmada(ruta: string): Promise<string | null>
}

/** Puente de quien tiene cuenta: Supabase directo. */
function puenteCuenta(): Puente {
  const sb = createClient()
  return {
    modo: 'cuenta',
    sb: sb as unknown as Sb,
    async subirMedio(m) {
      const { error } = await sb.storage.from('rondas')
        .upload(m.ruta, m.blob as Blob, { contentType: m.mime, upsert: false })
      // Un archivo que ya existía con la misma ruta es un reintento: el nombre
      // lleva el id de la evidencia, que lo generó este celular.
      if (error && !/exists/i.test(error.message)) throw new Error(error.message)
      return m.ruta
    },
    async urlFirmada(ruta) {
      const { data } = await sb.storage.from('rondas').createSignedUrl(ruta, 300)
      return data?.signedUrl ?? null
    },
  }
}

/** Puente de quien entró con enlace + PIN: por los route handlers de campo. */
function puenteSesion(): Puente {
  const sb: Sb = {
    from() { throw new Error('La sesión de campo no lee tablas directo.') },
    async rpc(fn, args) {
      const res = await fetch('/api/campo/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fn, args: args ?? {} }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return { data: null, error: { message: j.error ?? 'Error de red' } }
      return { data: j.data, error: null }
    },
  }
  return {
    modo: 'sesion',
    sb,
    async subirMedio(m) {
      const form = new FormData()
      form.set('ruta', m.ruta)
      form.set('archivo', m.blob as Blob)
      const res = await fetch('/api/campo/medios', { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'No se pudo subir el archivo')
      return j.ruta as string
    },
    async urlFirmada(ruta) {
      const res = await fetch(`/api/campo/medios?ruta=${encodeURIComponent(ruta)}`)
      if (!res.ok) return null
      const j = await res.json().catch(() => ({}))
      return j.url ?? null
    },
  }
}

export function crearPuente(modo: ModoPuente): Puente {
  return modo === 'cuenta' ? puenteCuenta() : puenteSesion()
}

/** Manejadores del outbox: cada intent es una RPC, y la RPC la resuelve el
 *  puente. `RPC_DE_INTENT` es la tabla del núcleo, así que los nombres no se
 *  repiten aquí. */
function registro(): PushRegistry {
  const r = new PushRegistry()
  for (const [kind, fn] of Object.entries(RPC_DE_INTENT)) {
    r.on(kind, async (sb, payload) => {
      const { error } = await sb.rpc(fn, payload)
      if (error) throw new Error(error.message)
    })
  }
  return r
}

/**
 * Pone la visita en la cola: primero sus archivos, después sus intents en el
 * orden que define el núcleo. No manda nada: eso lo hace `sincronizar()`,
 * cuando haya señal.
 */
export async function encolarVisita(v: VisitaLocal, actor: Actor): Promise<void> {
  const intents = intentsDeVisita(v, actor)
  let orden = 0
  for (const i of intents) {
    await encolar(almacen, i.kind, i.payload, undefined, { grupo: v.id, orden: orden++ })
  }
  await almacen.guardarVisita(v)
}

/** Agrega un archivo a la cola de medios, con su huella ya calculada. */
export async function encolarMedio(m: MedioPendiente): Promise<void> {
  await almacen.addMedio(m)
}

export interface ResultadoSincronizacion {
  mediosSubidos: number
  mediosPendientes: number
  mediosAtascados: number
  intentsEnviados: number
  visitasDetenidas: string[]
  errores: string[]
}

/**
 * Sube lo que haya pendiente. El ORDEN es el del ADR-D y no es negociable:
 * primero los archivos, después los intents. Si una foto no subió, el cierre de
 * su visita no se manda —`pushOutboxPorGrupo` detiene ese grupo—, porque el
 * cierre valida los mínimos de foto y la visita quedaría INCOMPLETA por un
 * problema de red.
 */
export async function sincronizar(puente: Puente): Promise<ResultadoSincronizacion> {
  const medios = await subirMedios(almacen, (m) => puente.subirMedio(m))
  const push = await pushOutboxPorGrupo(puente.sb, almacen, registro())
  // Una visita cuyos intents ya salieron todos se puede olvidar localmente.
  const pendientesPorGrupo = new Set((await almacen.getOutbox()).map((i) => i.grupo))
  for (const v of await almacen.visitas<VisitaLocal>()) {
    const cerrada = v.estado === 'COMPLETADA' || v.estado === 'INCOMPLETA'
    if (cerrada && !pendientesPorGrupo.has(v.id)) await almacen.borrarVisita(v.id)
  }
  return {
    mediosSubidos: medios.subidos,
    mediosPendientes: medios.pendientes,
    mediosAtascados: medios.atascados.length,
    intentsEnviados: push.pushed,
    visitasDetenidas: push.gruposDetenidos,
    errores: [...medios.errores, ...push.errores],
  }
}

/** Qué hay pendiente, para la pantalla de la cola. */
export async function estadoCola(): Promise<{
  visitas: { id: string; numero: string | null; punto: string; estado: string; cuando: string; medios: number }[]
  intents: number
}> {
  const outbox = await almacen.getOutbox()
  const medios = await resumenMedios(almacen)
  const visitas = await almacen.visitas<VisitaLocal>()
  const porGrupo = new Map<string, number>()
  for (const i of outbox) porGrupo.set(i.grupo ?? '', (porGrupo.get(i.grupo ?? '') ?? 0) + 1)
  return {
    intents: outbox.length,
    visitas: visitas
      .filter((v) => (porGrupo.get(v.id) ?? 0) > 0 || (medios[v.id]?.pendientes ?? 0) > 0)
      .map((v) => ({
        id: v.id,
        numero: null,
        punto: v.puntoNombre,
        estado: v.estado,
        cuando: v.inicio.tDispositivo,
        medios: medios[v.id]?.pendientes ?? 0,
      })),
  }
}

/** Lee la ubicación del celular con la mejor precisión que dé en el tiempo que
 *  se le deje. No se queda esperando para siempre: en un sótano no va a llegar
 *  nunca, y la visita tiene que poder abrirse igual. */
export function leerUbicacion(
  msEspera = 8000,
): Promise<{ lat: number | null; lng: number | null; precisionMetros: number | null; error?: string }> {
  return new Promise((resolver) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolver({ lat: null, lng: null, precisionMetros: null, error: 'Este celular no da la ubicación.' })
      return
    }
    let listo = false
    const terminar = (r: { lat: number | null; lng: number | null; precisionMetros: number | null; error?: string }) => {
      if (listo) return
      listo = true
      resolver(r)
    }
    const temporizador = setTimeout(
      () => terminar({ lat: null, lng: null, precisionMetros: null, error: 'La ubicación tardó demasiado.' }),
      msEspera)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(temporizador)
        terminar({
          lat: Number(p.coords.latitude.toFixed(7)),
          lng: Number(p.coords.longitude.toFixed(7)),
          precisionMetros: p.coords.accuracy != null ? Math.round(p.coords.accuracy) : null,
        })
      },
      (e) => {
        clearTimeout(temporizador)
        terminar({
          lat: null, lng: null, precisionMetros: null,
          error: e.code === e.PERMISSION_DENIED
            ? 'No diste permiso de ubicación.'
            : 'No se pudo leer la ubicación.',
        })
      },
      { enableHighAccuracy: true, timeout: msEspera, maximumAge: 15000 },
    )
  })
}
