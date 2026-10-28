'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Keyboard, CloudUpload, LogOut, ShieldCheck } from 'lucide-react'
import { clasificarEntrada, formatearManual } from '@conserjes/ronda-core'
import { crearPuente, estadoCola, sincronizar } from '@/lib/campo/cola'
import { EscanerQr } from './EscanerQr'
import { PuertaConsentimientos } from './PuertaConsentimientos'
import {
  TurnoYUbicacion,
  type ProximaParada, type SedeTurno, type TurnoAbierto,
} from './TurnoYUbicacion'
import type { TipoConsentimiento } from '@/lib/campo/consentimientos'

export interface ActorPwa {
  personaId: string
  nombre: string | null
  modo: 'cuenta' | 'sesion'
  sesionId: string | null
}

/**
 * Inicio: escanear o escribir el código, y ver qué falta por enviar.
 *
 * Botones de 56 px de alto y textos cortos: esto se usa con guantes, de noche y
 * con una mano. El escáner se abre solo si la persona lo pide, porque pedir la
 * cámara al entrar asusta y gasta batería.
 */
export function InicioCampo({
  actor, faltanConsentimientos, bloqueantes,
  turno = null, parada = null, sedesTurno = [],
  consienteSeguimiento = false, seguimientoHabilitado = false, intervaloSeg = 120,
}: {
  actor: ActorPwa
  faltanConsentimientos: TipoConsentimiento[]
  bloqueantes: TipoConsentimiento[]
  // F8: el turno y la ubicación. Opcionales para que la pantalla siga
  // funcionando igual donde no se pasen.
  turno?: TurnoAbierto | null
  parada?: ProximaParada | null
  sedesTurno?: SedeTurno[]
  consienteSeguimiento?: boolean
  seguimientoHabilitado?: boolean
  intervaloSeg?: number
}) {
  const router = useRouter()
  const [escaneando, setEscaneando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cola, setCola] = useState<{ visitas: number; medios: number }>({ visitas: 0, medios: 0 })
  const [enviando, setEnviando] = useState(false)
  const [pidiendo, setPidiendo] = useState(bloqueantes.length > 0)
  // Para volver a ofrecer un consentimiento que se dijo que no (F8: el de
  // seguimiento se puede reconsiderar sin tener que salir y volver a entrar).
  const [repreguntar, setRepreguntar] = useState<TipoConsentimiento[]>([])

  const refrescarCola = async () => {
    try {
      const e = await estadoCola()
      setCola({
        visitas: e.visitas.length,
        medios: e.visitas.reduce((n, v) => n + v.medios, 0),
      })
    } catch { /* un navegador sin IndexedDB no muestra cola */ }
  }

  useEffect(() => { void refrescarCola() }, [])

  // Al volver la señal se intenta enviar solo. Es lo que hace que una ronda
  // hecha en un sótano suba sin que nadie se acuerde de pulsar nada.
  useEffect(() => {
    const alConectar = () => { void enviar() }
    window.addEventListener('online', alConectar)
    return () => window.removeEventListener('online', alConectar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.modo])

  async function enviar() {
    if (enviando) return
    setEnviando(true)
    try {
      const r = await sincronizar(crearPuente(actor.modo))
      await refrescarCola()
      if (r.errores.length > 0 && r.intentsEnviados === 0 && r.mediosSubidos === 0) {
        setError('No se pudo enviar todavía. Lo que hiciste está guardado.')
      } else {
        setError(null)
      }
    } catch {
      setError('No se pudo enviar todavía. Lo que hiciste está guardado.')
    } finally {
      setEnviando(false)
    }
  }

  function abrirCodigo(entrada: string) {
    const c = clasificarEntrada(entrada)
    if (!c.modo) {
      setError('Ese código no se parece a ninguno de los de las placas. Revísalo e inténtalo otra vez.')
      return
    }
    setError(null)
    router.push(`/campo/punto/${c.codigo}`)
  }

  if (pidiendo || repreguntar.length > 0) {
    const pedir = repreguntar.length > 0 ? repreguntar : faltanConsentimientos
    return (
      <PuertaConsentimientos
        actor={actor}
        pedir={pedir}
        obligatorios={repreguntar.length > 0 ? [] : bloqueantes}
        alTerminar={() => {
          setPidiendo(false)
          if (repreguntar.length > 0) {
            setRepreguntar([])
            // La respuesta la tiene que volver a leer el servidor: el estado
            // del consentimiento no se adivina desde el navegador.
            router.refresh()
          }
        }}
      />
    )
  }

  return (
    <main className="px-4 py-6">
      <header className="mb-6">
        <p className="text-sm text-gray-500">Hola</p>
        <h1 className="font-heading text-2xl font-bold leading-tight">
          {actor.nombre ?? 'Tu ronda'}
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          {actor.modo === 'cuenta' ? 'Entraste con tu cuenta' : 'Entraste con enlace y PIN'}
        </p>
      </header>

      {/* El turno y la ubicación (F8). Va ARRIBA del escáner a propósito: lo
          primero del día es entrar a turno, y el indicador de que se está
          compartiendo la ubicación tiene que verse sin desplazar la pantalla. */}
      <div className="mb-6">
        <TurnoYUbicacion
          turnoInicial={turno}
          paradaInicial={parada}
          sedes={sedesTurno}
          consienteSeguimiento={consienteSeguimiento}
          seguimientoHabilitado={seguimientoHabilitado}
          intervaloSeg={intervaloSeg}
          alPedirConsentimiento={(tipo) => setRepreguntar([tipo])}
        />
      </div>

      {escaneando ? (
        <EscanerQr
          alLeer={(texto) => { setEscaneando(false); abrirCodigo(texto) }}
          alCerrar={() => setEscaneando(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEscaneando(true)}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white shadow-sm active:scale-[0.99]"
        >
          <Camera className="h-6 w-6" /> Escanear el código
        </button>
      )}

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
        <label htmlFor="codigo" className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Keyboard className="h-4 w-4" /> O escribe el código de la placa
        </label>
        <input
          id="codigo"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') abrirCodigo(codigo) }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="K7M4-QX9T"
          className="mt-2 h-14 w-full rounded-xl border-2 border-gray-200 px-4 text-center font-mono text-xl tracking-widest focus:border-brand-green focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          Son los 8 caracteres que están debajo del QR: {formatearManual('K7M4QX9T')}
        </p>
        <button
          type="button"
          onClick={() => abrirCodigo(codigo)}
          disabled={codigo.trim().length < 8}
          className="mt-3 h-14 w-full rounded-xl bg-gray-900 text-base font-bold text-white disabled:opacity-40"
        >
          Abrir el punto
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>
      )}

      {(cola.visitas > 0 || cola.medios > 0) && (
        <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="font-semibold text-sky-900">
            {cola.visitas === 1 ? 'Hay 1 ronda sin enviar' : `Hay ${cola.visitas} rondas sin enviar`}
          </p>
          <p className="mt-0.5 text-sm text-sky-800">
            {cola.medios > 0
              ? `Faltan ${cola.medios} archivos por subir. Se envía solo cuando haya señal.`
              : 'Se envía solo cuando haya señal.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-sky-700 font-bold text-white disabled:opacity-50"
            >
              <CloudUpload className="h-5 w-5" /> {enviando ? 'Enviando…' : 'Enviar ahora'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/campo/cola')}
              className="h-12 rounded-xl border border-sky-300 px-4 font-semibold text-sky-800"
            >
              Ver
            </button>
          </div>
        </div>
      )}

      {actor.modo === 'sesion' && (
        <button
          type="button"
          onClick={async () => {
            await fetch('/api/campo/entrar/verificar', { method: 'DELETE' })
            router.push('/campo/entrar')
          }}
          className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600"
        >
          <LogOut className="h-4 w-4" /> Salir
        </button>
      )}
    </main>
  )
}
