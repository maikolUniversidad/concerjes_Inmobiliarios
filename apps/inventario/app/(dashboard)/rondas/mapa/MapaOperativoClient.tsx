'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  AlertTriangle, History, MapPin, Pause, Play, RefreshCw, Route, SkipBack, User, WifiOff,
} from 'lucide-react'
import {
  rotuloPosicion,
  type PuntoMapa, type PuntoPersona, type PuntoRecorrido,
} from '@/components/logistica/MapaLeaflet'
import { cargarRecorrido, refrescarMapa } from './actions'
import type {
  PersonaEnMapa, PersonaSinUbicacion, PuntoControlMapa, PuntoRecorridoFila, SedeMapa, TurnoRecorrible,
} from './datos'

const MapaLeaflet = dynamic(() => import('@/components/logistica/MapaLeaflet'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 520 }} className="flex items-center justify-center rounded-xl bg-gray-50 text-gray-400">
      Cargando mapa…
    </div>
  ),
})

const REFRESCO_MS = 30_000

interface Props {
  personasIniciales: PersonaEnMapa[]
  sinUbicacionIniciales: PersonaSinUbicacion[]
  sedes: SedeMapa[]
  puntos: PuntoControlMapa[]
  turnos: TurnoRecorrible[]
  puedeRecorrido: boolean
}

/**
 * El mapa operativo. Dos modos que no se mezclan:
 *   · EN VIVO — quién está en turno y dónde, refrescado cada 30 s contra el
 *     servidor (y por realtime cuando llega un cambio);
 *   · RECORRIDO — el replay de un turno que ya pasó, con su reproductor.
 *
 * Por qué el refresco vuelve al servidor en vez de restar con el reloj local:
 * R2 exige que la antigüedad la calcule el servidor. Este componente NUNCA
 * resta fechas para saber de cuándo es una posición; solo pinta el número que
 * le llega. Si el refresco fallara, lo que se ve queda marcado como «sin
 * actualizar» en vez de envejecer en silencio.
 */
export function MapaOperativoClient({
  personasIniciales, sinUbicacionIniciales, sedes, puntos, turnos, puedeRecorrido,
}: Props) {
  const [modo, setModo] = useState<'vivo' | 'recorrido'>('vivo')
  const [personas, setPersonas] = useState(personasIniciales)
  const [sinUbicacion, setSinUbicacion] = useState(sinUbicacionIniciales)
  const [sede, setSede] = useState<string>('')
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consultadoAt, setConsultadoAt] = useState<string | null>(new Date().toISOString())
  const [desactualizado, setDesactualizado] = useState(false)

  // Replay
  const [turnoSel, setTurnoSel] = useState<string>('')
  const [recorrido, setRecorrido] = useState<PuntoRecorridoFila[]>([])
  const [indice, setIndice] = useState(0)
  const [reproduciendo, setReproduciendo] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refrescar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    const r = await refrescarMapa(undefined, sede || undefined)
    if (!silencioso) setCargando(false)
    if (r.error) {
      setError(r.error)
      // Lo que está en pantalla ya no es de fiar como «actual»: se dice.
      setDesactualizado(true)
      return
    }
    setError(null)
    setDesactualizado(false)
    setPersonas(r.personas ?? [])
    setSinUbicacion(r.sinUbicacion ?? [])
    setConsultadoAt(r.consultadoAt ?? new Date().toISOString())
  }, [sede])

  // Refresco periódico mientras el modo en vivo esté a la vista.
  useEffect(() => {
    if (modo !== 'vivo') return
    const t = setInterval(() => { void refrescar(true) }, REFRESCO_MS)
    return () => clearInterval(t)
  }, [modo, refrescar])

  useEffect(() => { void refrescar(true) }, [sede]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reproductor del recorrido.
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (!reproduciendo || recorrido.length === 0) return
    timerRef.current = setInterval(() => {
      setIndice((i) => {
        if (i >= recorrido.length - 1) { setReproduciendo(false); return i }
        return i + 1
      })
    }, 350)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [reproduciendo, recorrido.length])

  async function elegirTurno(id: string) {
    setTurnoSel(id)
    setReproduciendo(false)
    setIndice(0)
    setRecorrido([])
    if (!id) return
    setCargando(true)
    const r = await cargarRecorrido(id)
    setCargando(false)
    if (r.error) { setError(r.error); return }
    setError(null)
    setRecorrido(r.puntos ?? [])
    setIndice((r.puntos?.length ?? 1) - 1)
  }

  const sedesConNombre = useMemo(
    () => sedes.filter((s) => s.lat != null && s.lng != null), [sedes])

  // ── Los puntos que van al mapa ──────────────────────────────────────────────
  const puntosMapa = useMemo<(PuntoMapa | PuntoPersona)[]>(() => {
    const out: (PuntoMapa | PuntoPersona)[] = []

    // Sedes: punto con radio. El «polígono» de la sede mientras no exista el
    // levantamiento 2D/3D.
    for (const s of sedesConNombre) {
      if (sede && s.id !== sede) continue
      out.push({
        id: `sede-${s.id}`, lat: s.lat as number, lng: s.lng as number, tipo: 'sede',
        titulo: s.nombre, detalle: s.direccion ?? undefined,
        capa: 'Sedes', color: '#64748b', radioMetros: 120,
      })
    }

    // Puntos de control, agrupados por piso en capas (los «planos por piso» que
    // los datos de hoy permiten).
    for (const p of puntos) {
      if (sede && p.sede_id !== sede) continue
      out.push({
        id: `punto-${p.id}`, lat: p.lat as number, lng: p.lng as number, tipo: 'punto',
        titulo: `${p.codigo} · ${p.nombre}`,
        detalle: p.piso ? `Piso ${p.piso}` : undefined,
        estado: p.estado === 'ACTIVO' ? 'EN_CURSO' : 'PENDIENTE',
        capa: p.piso ? `Puntos · piso ${p.piso}` : 'Puntos de control',
        radioMetros: p.geocerca_metros,
        color: p.estado === 'ACTIVO' ? '#6366f1' : '#9ca3af',
      })
    }

    if (modo === 'vivo') {
      for (const p of personas) {
        if (seleccionada && p.persona_id !== seleccionada) continue
        // R2: la antigüedad, la fuente y `enVivo` son OBLIGATORIOS en el tipo
        // `persona`, así que no hay forma de dibujar a alguien sin decir de
        // cuándo es su posición.
        out.push({
          id: `persona-${p.persona_id}`, lat: p.lat, lng: p.lng, tipo: 'persona',
          titulo: p.persona_nombre || 'Sin nombre',
          detalle: [p.sede_nombre, p.ruta_codigo, p.punto_nombre].filter(Boolean).join(' · ') || undefined,
          antiguedadSeg: p.antiguedad_seg,
          fuente: p.fuente,
          enVivo: p.en_vivo,
          capa: 'Personas en turno',
          velocidad: p.velocidad_kmh,
          radioMetros: p.precision_metros && p.precision_metros > 25 ? p.precision_metros : undefined,
        } satisfies PuntoPersona)
      }
    }

    // En modo recorrido, las paradas que se hicieron en un punto de control.
    if (modo === 'recorrido') {
      let n = 0
      for (const r of recorrido) {
        if (!r.punto_id) continue
        n += 1
        out.push({
          id: `paso-${r.orden}`, lat: r.lat, lng: r.lng, tipo: 'parada',
          titulo: r.punto_nombre ?? 'Punto de control',
          detalle: new Date(r.capturado_at).toLocaleString('es-CO'),
          orden: n, estado: 'CUMPLIDA', capa: 'Puntos visitados',
        })
      }
    }

    return out
  }, [sedesConNombre, puntos, personas, recorrido, modo, sede, seleccionada])

  const trazo = useMemo<PuntoRecorrido[]>(
    () => recorrido.map((r) => ({
      lat: r.lat, lng: r.lng, capturadoAt: r.capturado_at,
      fuente: r.fuente, puntoNombre: r.punto_nombre,
    })),
    [recorrido],
  )

  const actual = recorrido[indice]
  const turnoActual = turnos.find((t) => t.turno_id === turnoSel)

  return (
    <div className="space-y-4">
      {/* Modo y filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setModo('vivo')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
              modo === 'vivo' ? 'bg-brand-green text-white' : 'text-gray-600'}`}
          >
            <MapPin className="h-4 w-4" /> En vivo
          </button>
          <button
            type="button"
            onClick={() => setModo('recorrido')}
            disabled={!puedeRecorrido}
            title={puedeRecorrido ? undefined
              : 'Necesitas el permiso «Reproducir el recorrido de un turno pasado».'}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${
              modo === 'recorrido' ? 'bg-brand-green text-white' : 'text-gray-600'}`}
          >
            <History className="h-4 w-4" /> Recorrido
          </button>
        </div>

        <select
          value={sede}
          onChange={(e) => { setSede(e.target.value); setSeleccionada(null) }}
          className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-sm"
        >
          <option value="">Todas las sedes</option>
          {sedesConNombre.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>

        {modo === 'recorrido' && (
          <select
            value={turnoSel}
            onChange={(e) => void elegirTurno(e.target.value)}
            className="h-9 min-w-[18rem] rounded-xl border border-gray-200 bg-white px-3 text-sm"
          >
            <option value="">Elige un turno para reproducir…</option>
            {turnos
              .filter((t) => !sede || t.sede_id === sede)
              .map((t) => (
                <option key={t.turno_id} value={t.turno_id}>
                  {new Date(t.inicio_at).toLocaleString('es-CO', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                  {' · '}{t.persona_nombre || 'Sin nombre'}
                  {' · '}{t.puntos_registrados} registros
                </option>
              ))}
          </select>
        )}

        {modo === 'vivo' && (
          <button
            type="button"
            onClick={() => void refrescar()}
            disabled={cargando}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        )}

        {modo === 'vivo' && consultadoAt && (
          <span className={`text-xs ${desactualizado ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>
            {desactualizado
              ? 'Sin actualizar: lo que ves puede no ser lo actual'
              : `Consultado a las ${new Date(consultadoAt).toLocaleTimeString('es-CO', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}`}
          </span>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <MapaLeaflet
            puntos={puntosMapa}
            alto={520}
            capasVisibles
            capasApagadas={['Sedes']}
            recorrido={modo === 'recorrido' ? trazo : undefined}
            recorridoHasta={modo === 'recorrido' ? indice : undefined}
          />

          {/* Reproductor de la línea de tiempo */}
          {modo === 'recorrido' && recorrido.length > 1 && (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setIndice(0); setReproduciendo(false) }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600"
                  aria-label="Volver al inicio"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setReproduciendo((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green text-white"
                  aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
                >
                  {reproduciendo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={recorrido.length - 1}
                  value={indice}
                  onChange={(e) => { setReproduciendo(false); setIndice(Number(e.target.value)) }}
                  className="h-2 flex-1 accent-brand-green"
                  aria-label="Momento del recorrido"
                />
                <span className="w-28 shrink-0 text-right font-mono text-xs text-gray-600">
                  {actual
                    ? new Date(actual.capturado_at).toLocaleTimeString('es-CO',
                        { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '—'}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Registro {indice + 1} de {recorrido.length}
                {turnoActual && ` · ${turnoActual.persona_nombre || 'Sin nombre'}`}
                {turnoActual && ` · ${Math.round(turnoActual.metros_recorridos)} m recorridos en el turno`}
                {actual?.punto_nombre && ` · en ${actual.punto_nombre}`}
              </p>
              {recorrido.length >= 500 && (
                <p className="mt-1 text-xs text-gray-400">
                  El recorrido se muestra resumido: el servidor devuelve como máximo 500 registros
                  por turno, conservando el primero, el último y cada paso por un punto de control.
                </p>
              )}
            </div>
          )}

          {modo === 'recorrido' && turnoSel && recorrido.length <= 1 && !cargando && (
            <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              Ese turno no tiene suficientes registros para dibujar un recorrido.
            </p>
          )}
        </div>

        {/* Lista lateral */}
        <div className="space-y-3">
          {modo === 'vivo' ? (
            <>
              <div className="rounded-xl border border-gray-200 bg-white">
                <p className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  En turno con ubicación
                </p>
                {personas.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-gray-500">
                    Nadie con ubicación en este momento.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {personas.map((p) => (
                      <li key={p.persona_id}>
                        <button
                          type="button"
                          onClick={() => setSeleccionada(
                            seleccionada === p.persona_id ? null : p.persona_id)}
                          className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50 ${
                            seleccionada === p.persona_id ? 'bg-emerald-50' : ''}`}
                        >
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                            p.en_vivo ? 'bg-emerald-600 text-white' : 'border-2 border-dashed border-gray-400 text-gray-500'}`}>
                            <User className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-gray-900">
                              {p.persona_nombre || 'Sin nombre'}
                            </span>
                            {/* R2: la antigüedad y la fuente, siempre, con el
                                formato «hace 12 min · WhatsApp». */}
                            <span className={`block text-xs ${
                              p.en_vivo ? 'font-medium text-emerald-700' : 'text-gray-500'}`}>
                              {rotuloPosicion(p.antiguedad_seg, p.fuente)}
                            </span>
                            {!p.en_vivo && (
                              <span className="block text-[11px] text-gray-400">
                                Último registro, no posición en vivo
                              </span>
                            )}
                            <span className="block truncate text-xs text-gray-500">
                              {[p.sede_nombre, p.ruta_codigo].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* R2: quien no tiene NINGUNA posición aparece en la lista, no en
                  el mapa. */}
              {sinUbicacion.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white">
                  <p className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <WifiOff className="h-3.5 w-3.5" /> En turno sin ubicación
                  </p>
                  <ul className="divide-y divide-gray-100">
                    {sinUbicacion.map((p) => (
                      <li key={p.turno_id} className="px-3 py-2.5">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {p.persona_nombre || 'Sin nombre'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {p.sede_nombre ?? 'Sin sede'} · en turno desde las{' '}
                          {new Date(p.turno_inicio_at).toLocaleTimeString('es-CO',
                            { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Route className="h-3.5 w-3.5" /> Turnos reproducibles
              </p>
              {turnos.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  Todavía no hay turnos con rastro que reproducir.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {turnos.filter((t) => !sede || t.sede_id === sede).slice(0, 25).map((t) => (
                    <li key={t.turno_id}>
                      <button
                        type="button"
                        onClick={() => void elegirTurno(t.turno_id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm ${
                          turnoSel === t.turno_id
                            ? 'border-brand-green bg-emerald-50'
                            : 'border-gray-200 hover:bg-gray-50'}`}
                      >
                        <span className="block truncate font-semibold text-gray-900">
                          {t.persona_nombre || 'Sin nombre'}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {new Date(t.inicio_at).toLocaleString('es-CO', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                          {' · '}{t.puntos_registrados} registros
                          {' · '}{Math.round(t.metros_recorridos)} m
                        </span>
                        <span className="block text-xs text-gray-400">
                          {t.sede_nombre ?? 'Sin sede'}
                          {t.fin_at
                            ? ` · cerrado a las ${new Date(t.fin_at).toLocaleTimeString('es-CO',
                                { hour: '2-digit', minute: '2-digit' })}`
                            : ' · sin cerrar'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500">
            La ubicación se registra solo durante el turno, con el consentimiento de la persona y
            si el contrato lo tiene habilitado. El rastro detallado se conserva los meses que
            indique el contrato (3 por defecto) y después se borra.
          </p>
        </div>
      </div>
    </div>
  )
}
