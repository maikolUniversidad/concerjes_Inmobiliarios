'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, LogIn, LogOut, MapPin, Navigation, Radio, ShieldOff,
} from 'lucide-react'
import type { TipoConsentimiento } from '@/lib/campo/consentimientos'

/**
 * El turno y el reporte de ubicación en la PWA de campo (F8).
 *
 * Tres cosas que no son adorno, y por qué están escritas así:
 *
 * 1. NO REPORTA SIN CONSENTIMIENTO. `consienteSeguimiento` llega del servidor
 *    leyendo `persona_consentimientos`, y sin él este componente ni pide la
 *    ubicación al navegador. No es la única defensa —la base rechaza igual,
 *    porque R1 vive ahí— pero pedir el GPS a alguien que dijo que no es, en sí
 *    mismo, una falta de respeto.
 *
 * 2. INDICADOR VISIBLE SIEMPRE QUE ESTÉ ACTIVO (§10.3 y las reglas de Android e
 *    iOS): mientras se comparte ubicación hay una banda verde en pantalla que
 *    lo dice, con el punto pulsando y la hora del último envío. No hay forma de
 *    que esté reportando sin que se vea.
 *
 * 3. SE APAGA SOLO SI LA BASE LO RECHAZA. Un 403 de la ruta —fuera de turno,
 *    contrato que no lo permite, consentimiento retirado— detiene el reloj y lo
 *    dice. No reintenta en bucle contra una regla que no va a cambiar.
 *
 * El seguimiento en segundo plano NO está aquí: con la pantalla apagada el
 * navegador suspende el temporizador. Eso solo lo da la app nativa (§1.1), y
 * esta pantalla lo dice en una línea para que nadie piense que su posición
 * sigue llegando con el celular en el bolsillo.
 */

export interface TurnoAbierto {
  id: string
  grupo_id: string
  sede_id: string
  inicio_at: string
  fin_previsto_at: string
  puntos_registrados: number
  metros_recorridos: number
  ultima_posicion_at: string | null
}

export interface ProximaParada {
  estado: 'SIN_RUTA' | 'RUTA_TERMINADA' | 'PARADA'
  paradas_pendientes?: number
  ruta?: { codigo: string; nombre: string }
  parada?: { numero: number; hora_estimada: string | null }
  punto?: {
    codigo: string; nombre: string; como_llegar: string | null
    piso: string | null; zona: string | null; sede: string | null
  }
}

export interface SedeTurno { id: string; nombre: string }

interface Props {
  turnoInicial: TurnoAbierto | null
  paradaInicial: ProximaParada | null
  /** Sedes en las que esta persona puede abrir turno. */
  sedes: SedeTurno[]
  /** ¿Dio el consentimiento de SEGUIMIENTO? Lo lee el servidor. */
  consienteSeguimiento: boolean
  /** ¿El contrato del turno tiene el seguimiento habilitado? */
  seguimientoHabilitado: boolean
  /** Intervalo mínimo del contrato, en segundos. */
  intervaloSeg: number
  /** Para volver a pedir el consentimiento que falta. */
  alPedirConsentimiento?: (tipo: TipoConsentimiento) => void
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

export function TurnoYUbicacion({
  turnoInicial, paradaInicial, sedes, consienteSeguimiento,
  seguimientoHabilitado, intervaloSeg, alPedirConsentimiento,
}: Props) {
  const [turno, setTurno] = useState<TurnoAbierto | null>(turnoInicial)
  const [parada, setParada] = useState<ProximaParada | null>(paradaInicial)
  const [sede, setSede] = useState<string>(sedes[0]?.id ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compartiendo, setCompartiendo] = useState(false)
  const [ultimoEnvio, setUltimoEnvio] = useState<string | null>(turnoInicial?.ultima_posicion_at ?? null)
  const [detenido, setDetenido] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const puedeCompartir = !!turno && consienteSeguimiento && seguimientoHabilitado

  const enviarPosicion = useCallback(async () => {
    if (!navigator.geolocation) {
      setDetenido('Este teléfono no da la ubicación.')
      setCompartiendo(false)
      return
    }
    const pos = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      )
    })
    if (!pos) {
      // Un fallo del GPS no apaga el reporte: en un sótano se recupera solo.
      setError('Sin señal de GPS por ahora. Se vuelve a intentar.')
      return
    }
    try {
      const res = await fetch('/api/campo/turno', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: pos.coords.accuracy ?? null,
          velocidad: pos.coords.speed == null ? null : pos.coords.speed * 3.6,
          rumbo: pos.coords.heading ?? null,
          capturado: new Date(pos.timestamp).toISOString(),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 403) {
        // La base dijo que no. Se apaga y se explica: reintentar contra una
        // regla que no va a cambiar solo gasta batería.
        setCompartiendo(false)
        setDetenido(j.error ?? 'No se puede registrar tu ubicación ahora.')
        return
      }
      if (!res.ok) { setError(j.error ?? 'No se pudo enviar la ubicación.'); return }
      setError(null)
      if (j.estado === 'REGISTRADA') setUltimoEnvio(j.capturado_at ?? new Date().toISOString())
      // `IGNORADA` no es un fallo: llegó antes del intervalo mínimo. Se calla.
    } catch {
      setError('Sin conexión. Se vuelve a intentar.')
    }
  }, [])

  // El reloj del reporte. El intervalo lo manda el CONTRATO, no el código:
  // mandar más seguido que su intervalo mínimo solo gasta batería, porque la
  // base ignora lo que llega antes de tiempo.
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (!compartiendo || !puedeCompartir) return
    void enviarPosicion()
    const ms = Math.max(30, intervaloSeg) * 1000
    timerRef.current = setInterval(() => { void enviarPosicion() }, ms)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [compartiendo, puedeCompartir, intervaloSeg, enviarPosicion])

  async function recargar() {
    const res = await fetch('/api/campo/turno')
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setTurno(j.turno ?? null)
      setParada(j.parada ?? null)
      setUltimoEnvio(j.turno?.ultima_posicion_at ?? null)
    }
  }

  async function abrirTurno() {
    if (!sede) { setError('Elige la sede donde vas a trabajar.'); return }
    setOcupado(true); setError(null); setDetenido(null)
    const res = await fetch('/api/campo/turno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'abrir', sede }),
    })
    const j = await res.json().catch(() => ({}))
    setOcupado(false)
    if (!res.ok) { setError(j.error ?? 'No se pudo abrir el turno.'); return }
    await recargar()
  }

  async function cerrarTurno() {
    setOcupado(true); setError(null)
    // Se apaga el reporte ANTES de cerrar: que no quede un envío en vuelo
    // después de que la persona ya salió de turno.
    setCompartiendo(false)
    const res = await fetch('/api/campo/turno', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'cerrar' }),
    })
    const j = await res.json().catch(() => ({}))
    setOcupado(false)
    if (!res.ok) { setError(j.error ?? 'No se pudo cerrar el turno.'); return }
    setTurno(null); setParada(null); setUltimoEnvio(null); setDetenido(null)
  }

  return (
    <section className="space-y-3">
      {/* INDICADOR VISIBLE. Mientras comparte, esto está en pantalla. */}
      {compartiendo && puedeCompartir && (
        <div className="flex items-start gap-2.5 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-3">
          <span className="relative mt-0.5 flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-600" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-emerald-900">
              Estás compartiendo tu ubicación
            </p>
            <p className="text-xs text-emerald-800">
              {ultimoEnvio ? `Último envío a las ${hora(ultimoEnvio)}` : 'Buscando tu posición…'}
              {' · '}cada {Math.max(30, intervaloSeg)} s mientras esta pantalla esté abierta
            </p>
            <button
              type="button"
              onClick={() => setCompartiendo(false)}
              className="mt-2 h-10 rounded-xl border border-emerald-600 px-3 text-sm font-bold text-emerald-800"
            >
              Dejar de compartir
            </button>
          </div>
        </div>
      )}

      {detenido && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0" /> {detenido}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {turno ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <Radio className="h-3.5 w-3.5" /> En turno
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Desde las {hora(turno.inicio_at)} · termina a las {hora(turno.fin_previsto_at)}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {turno.puntos_registrados > 0
              ? `${turno.puntos_registrados} registros de ubicación · ${Math.round(turno.metros_recorridos)} m`
              : 'Sin registros de ubicación todavía'}
          </p>

          {/* La próxima parada: lo mismo que F10 contestará por WhatsApp. */}
          {parada?.estado === 'PARADA' && parada.punto && (
            <div className="mt-3 rounded-xl bg-indigo-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                Tu próxima parada
                {parada.parada?.numero != null && ` · nº ${parada.parada.numero}`}
                {parada.paradas_pendientes != null && (parada.paradas_pendientes === 1
                  ? ' · es la última'
                  : ` · quedan ${parada.paradas_pendientes}`)}
              </p>
              <p className="mt-0.5 font-bold text-indigo-950">
                {parada.punto.codigo} · {parada.punto.nombre}
              </p>
              <p className="text-sm text-indigo-900">
                {[parada.punto.zona, parada.punto.piso && `piso ${parada.punto.piso}`]
                  .filter(Boolean).join(' · ')}
                {parada.parada?.hora_estimada && ` · a las ${parada.parada.hora_estimada.slice(0, 5)}`}
              </p>
              {parada.punto.como_llegar && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-indigo-900">
                  <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {parada.punto.como_llegar}
                </p>
              )}
            </div>
          )}
          {parada?.estado === 'RUTA_TERMINADA' && (
            <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
              Terminaste todas las paradas de tu ruta de hoy.
            </p>
          )}

          {!compartiendo && (
            <div className="mt-3 space-y-2">
              {!consienteSeguimiento ? (
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-sm text-gray-700">
                    No autorizaste compartir tu ubicación durante el turno, así que no se está
                    registrando. Puedes trabajar igual.
                  </p>
                  {alPedirConsentimiento && (
                    <button
                      type="button"
                      onClick={() => alPedirConsentimiento('SEGUIMIENTO')}
                      className="mt-2 h-11 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700"
                    >
                      Leer y decidir otra vez
                    </button>
                  )}
                </div>
              ) : !seguimientoHabilitado ? (
                <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                  El contrato de esta sede no tiene habilitado el seguimiento de ubicación, así que
                  no se registra nada.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setDetenido(null); setCompartiendo(true) }}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 text-base font-bold text-white"
                  >
                    <MapPin className="h-5 w-5" /> Compartir mi ubicación
                  </button>
                  <p className="text-xs text-gray-500">
                    Solo mientras esta pantalla esté abierta: con el celular bloqueado se detiene.
                    Al salir de turno dejas de aparecer en el mapa.
                  </p>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void cerrarTurno()}
            disabled={ocupado}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" /> Salir de turno
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Turno</p>
          <p className="mt-1 text-sm text-gray-600">
            No tienes turno abierto. Fuera del turno no se registra ni se muestra tu ubicación.
          </p>
          {sedes.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              No hay ninguna sede asignada a tu acceso. Pídele a tu supervisor que te abra el turno.
            </p>
          ) : (
            <>
              <select
                value={sede}
                onChange={(e) => setSede(e.target.value)}
                className="mt-3 h-12 w-full rounded-xl border-2 border-gray-200 px-3 text-base"
              >
                {sedes.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void abrirTurno()}
                disabled={ocupado}
                className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-green text-base font-bold text-white disabled:opacity-60"
              >
                <LogIn className="h-5 w-5" /> Entrar a turno
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
