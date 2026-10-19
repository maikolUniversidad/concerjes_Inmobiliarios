'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, MapPinned, Play, RefreshCw, TriangleAlert } from 'lucide-react'
import {
  abrirVisita, evaluarGeocerca, type Geocerca, type Paso,
} from '@conserjes/ronda-core'
import { crearPuente, leerUbicacion } from '@/lib/campo/cola'
import { almacen } from '@/lib/campo/idb'
import { createClient } from '@/lib/supabase/client'
import type { ActorPwa } from './InicioCampo'

export interface TareaPwa {
  asignacionId: string
  plantillaId: string
  codigo: string
  nombre: string
  actividad: string
  pasos: number
  minutos: number | null
  prioridad: string
  enVentana: boolean
  enTolerancia: boolean
  ventana: string
  exigeFirma: boolean
  exigeGeocerca: boolean
}

export interface PuntoPwa {
  id: string
  nombre: string
  codigo: string
  lat: number | null
  lng: number | null
  geocercaMetros: number
  exigeGeocerca: boolean
}

/**
 * Las tareas del punto y la apertura de la visita.
 *
 * El orden importa y es el del ADR-02 §2.9: primero se lee la ubicación en el
 * DISPOSITIVO y se evalúa la geocerca ahí (con la precisión), y solo entonces
 * se abre la visita. Así la persona sabe qué va a pasar antes de empezar a
 * tomar fotos, y no después de media hora de trabajo.
 *
 * Y la visita se abre LOCAL: la fila en el servidor la crea la cola. En un
 * sótano sin señal esto tiene que funcionar igual, y el `id` lo genera el
 * celular para que el reintento no duplique nada.
 */
export function TareasDelPunto({
  actor, punto, qr, tareas,
}: {
  actor: ActorPwa
  punto: PuntoPwa
  qr: { id: string; aperturaModo: 'QR' | 'MANUAL' | 'ASISTIDA' }
  tareas: TareaPwa[]
}) {
  const router = useRouter()
  const [ubicando, setUbicando] = useState(true)
  const [geo, setGeo] = useState<Geocerca | null>(null)
  const [errorGps, setErrorGps] = useState<string | null>(null)
  const [lectura, setLectura] = useState<{ lat: number | null; lng: number | null; precisionMetros: number | null }>(
    { lat: null, lng: null, precisionMetros: null })
  const [motivo, setMotivo] = useState('')
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ubicar = async () => {
    setUbicando(true)
    setErrorGps(null)
    const u = await leerUbicacion()
    setLectura(u)
    setErrorGps(u.error ?? null)
    setGeo(evaluarGeocerca(
      { lat: punto.lat, lng: punto.lng, geocercaMetros: punto.geocercaMetros,
        exigeGeocerca: punto.exigeGeocerca },
      u))
    setUbicando(false)
  }

  useEffect(() => { void ubicar() }, [])

  async function empezar(t: TareaPwa) {
    if (abriendo) return
    setError(null)
    setAbriendo(t.plantillaId)
    try {
      // Los pasos de la plantilla: del servidor si hay señal, y si no, de la
      // copia local que dejó la última sincronización.
      const pasos = await leerPasos(t.plantillaId, actor.modo)
      if (pasos.length === 0) {
        setError('No se pudieron cargar los pasos de la tarea. Conéctate un momento y vuelve a intentar.')
        return
      }
      const id = crypto.randomUUID()
      const r = abrirVisita({
        id,
        puntoId: punto.id,
        puntoNombre: punto.nombre,
        plantillaId: t.plantillaId,
        plantillaCodigo: t.codigo,
        plantillaNombre: t.nombre,
        exigeFirma: t.exigeFirma,
        pasos,
        personaId: actor.personaId,
        identidadMetodo: actor.modo === 'cuenta' ? 'CUENTA' : 'ENLACE_PIN',
        sesionId: actor.sesionId,
        aperturaModo: qr.aperturaModo,
        qrId: qr.id,
        asignacionId: t.asignacionId,
        geocerca: evaluarGeocerca(
          { lat: punto.lat, lng: punto.lng, geocercaMetros: punto.geocercaMetros,
            exigeGeocerca: punto.exigeGeocerca },
          lectura, t.exigeGeocerca),
        motivoFueraGeocerca: motivo,
        lat: lectura.lat,
        lng: lectura.lng,
        precisionMetros: lectura.precisionMetros,
        // Si no hay red en este momento, la visita nace marcada como offline:
        // su hora de dispositivo se conserva y el servidor pondrá la suya.
        offline: typeof navigator !== 'undefined' && !navigator.onLine,
      })
      if (!r.ok) { setError(r.error); return }
      await almacen.guardarVisita(r.visita)
      router.push(`/campo/visita/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la visita.')
    } finally {
      setAbriendo(null)
    }
  }

  const exigeMotivo = geo?.exigeMotivo === true
  const faltaMotivo = exigeMotivo && motivo.trim().length < 5

  return (
    <section className="mt-5">
      {/* ── La ubicación, dicha en claro ─────────────────────────────────── */}
      <div className={'rounded-2xl border p-4 '
        + (ubicando ? 'border-gray-200 bg-white'
          : geo?.dudosa || geo?.dentro === false ? 'border-amber-300 bg-amber-50'
            : 'border-emerald-200 bg-emerald-50')}>
        <p className="flex items-center gap-2 font-semibold">
          <MapPinned className="h-4 w-4" />
          {ubicando ? 'Leyendo tu ubicación…' : geo?.dentro === true && !geo.dudosa
            ? 'Estás en el punto' : 'Revisa tu ubicación'}
        </p>
        {!ubicando && (
          <>
            <p className="mt-1 text-sm">{errorGps ?? geo?.mensaje}</p>
            {geo?.pedirReintento && (
              <button
                type="button"
                onClick={() => void ubicar()}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white font-semibold"
              >
                <RefreshCw className="h-4 w-4" /> Volver a leer la ubicación
              </button>
            )}
            {exigeMotivo && (
              <div className="mt-3">
                <label htmlFor="motivo" className="text-sm font-semibold">
                  ¿Por qué abres la visita así?
                </label>
                <textarea
                  id="motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="Ej.: el sótano no tiene señal y el GPS no entra"
                  className="mt-1.5 w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand-green focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-600">
                  Queda en el reporte. No es un problema: es para que tu supervisor entienda.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <h2 className="font-heading mt-6 text-lg font-bold">Qué toca aquí</h2>
      {tareas.length === 0 && (
        <p className="mt-2 rounded-2xl bg-white p-4 text-sm text-gray-600">
          No hay tareas asignadas a este punto. Avísale a tu supervisor.
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {tareas.map((t) => {
          const fuera = !t.enTolerancia
          return (
            <li key={t.asignacionId} className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">{t.actividad}</p>
              <h3 className="font-heading text-base font-bold leading-snug">{t.nombre}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {t.ventana}
                </span>
                <span>{t.pasos} pasos</span>
                {t.minutos && <span>~{t.minutos} min</span>}
                {t.exigeFirma && <span>pide firma</span>}
              </p>
              {fuera && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 p-2 text-xs text-amber-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Esta tarea no es de esta hora. Puedes hacerla igual y queda registrado cuándo.
                </p>
              )}
              <button
                type="button"
                onClick={() => void empezar(t)}
                disabled={ubicando || faltaMotivo || abriendo !== null}
                className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-green text-base font-bold text-white disabled:opacity-40"
              >
                <Play className="h-5 w-5" />
                {abriendo === t.plantillaId ? 'Abriendo…' : 'Empezar'}
              </button>
            </li>
          )
        })}
      </ul>

      {faltaMotivo && (
        <p className="mt-3 text-center text-xs text-gray-500">
          Escribe el motivo de la ubicación para poder empezar.
        </p>
      )}
      {error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    </section>
  )
}

/** Los pasos de la plantilla, del servidor o de la copia local. */
async function leerPasos(plantillaId: string, modo: 'cuenta' | 'sesion'): Promise<Paso[]> {
  const normalizar = (filas: Record<string, unknown>[]): Paso[] =>
    filas
      .map((p) => ({
        id: String(p.id),
        orden: Number(p.orden),
        tipo: p.tipo as Paso['tipo'],
        titulo: String(p.titulo),
        ayuda: (p.ayuda as string | null) ?? null,
        obligatorio: p.obligatorio !== false,
        config: (p.config as Paso['config']) ?? {},
        instructivo_id: (p.instructivo_id as string | null) ?? null,
        instructivo_momento: (p.instructivo_momento as Paso['instructivo_momento']) ?? null,
        condicion_paso_id: (p.condicion_paso_id as string | null) ?? null,
        condicion_valor: (p.condicion_valor as string | null) ?? null,
      }))
      .sort((a, b) => a.orden - b.orden)

  // La copia local primero: es instantánea y es la que hace que esto funcione
  // sin señal. Si no está, se pide al servidor y se guarda para la próxima.
  try {
    const locales = (await almacen.getAll('ronda_plantilla_pasos'))
      .filter((p) => String((p as { plantilla_id?: string }).plantilla_id) === plantillaId)
    if (locales.length > 0) return normalizar(locales as Record<string, unknown>[])
  } catch { /* sin IndexedDB se sigue por red */ }

  if (modo === 'cuenta') {
    const sb = createClient()
    const { data } = await sb
      .from('ronda_plantilla_pasos')
      .select('*')
      .eq('plantilla_id', plantillaId)
      .order('orden')
    const filas = (data ?? []) as Record<string, unknown>[]
    if (filas.length > 0) {
      try { await almacen.bulkPut('ronda_plantilla_pasos', filas as never) } catch { /* ignora */ }
    }
    return normalizar(filas)
  }

  const res = await fetch(`/api/campo/plantilla?id=${encodeURIComponent(plantillaId)}`)
  if (!res.ok) return []
  const j = await res.json().catch(() => ({ pasos: [] }))
  const filas = (j.pasos ?? []) as Record<string, unknown>[]
  if (filas.length > 0) {
    try { await almacen.bulkPut('ronda_plantilla_pasos', filas as never) } catch { /* ignora */ }
  }
  return normalizar(filas)
}
