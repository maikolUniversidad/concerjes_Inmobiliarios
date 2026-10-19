'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Send } from 'lucide-react'

/**
 * Entrar sin cuenta: documento → enlace + PIN → dentro.
 *
 * Dos pasos y nada más. Lo que esta pantalla NO hace, a propósito:
 *   · no dice si el documento existe. Si lo dijera, sería un verificador de
 *     cédulas de 6.564 personas abierto en internet;
 *   · no muestra el PIN. Va al canal verificado de la persona; el navegador que
 *     lo pidió no lo ve, porque si lo viera el canal verificado no serviría de
 *     nada;
 *   · no deja reintentar sin límite: el tope lo pone la base (tres solicitudes
 *     cada diez minutos, cinco intentos de PIN).
 *
 * Si el enlace llega con `?t=`, se salta directo al PIN: la persona viene de
 * tocar el enlace en su WhatsApp o su correo.
 */
export function FormaEntrar({
  tokenInicial, destino, punto,
}: { tokenInicial: string | null; destino: string; punto: string | null }) {
  const router = useRouter()
  const [paso, setPaso] = useState<'documento' | 'pin'>(tokenInicial ? 'pin' : 'documento')
  const [documento, setDocumento] = useState('')
  const [token, setToken] = useState(tokenInicial ?? '')
  const [pin, setPin] = useState('')
  const [canal, setCanal] = useState<'WHATSAPP' | 'CORREO'>('WHATSAPP')
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function pedir() {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/campo/entrar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documento, canal, punto, destino }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'No se pudo pedir el acceso.'); return }
      setAviso(j.mensaje ?? null)
      setPaso('pin')
    } catch {
      setError('Sin señal. Intenta otra vez cuando tengas internet.')
    } finally {
      setCargando(false)
    }
  }

  async function verificar() {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/campo/entrar/verificar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, pin }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setError(j.mensaje ?? j.error ?? 'No se pudo entrar.'); return }
      router.replace(j.destino || destino)
    } catch {
      setError('Sin señal. Intenta otra vez cuando tengas internet.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <main className="px-4 py-8">
      <h1 className="font-heading text-2xl font-bold leading-tight">Entrar a mi ronda</h1>
      <p className="mt-1 text-sm text-gray-500">
        Si tienes cuenta del sistema, entra por la pantalla normal de ingreso.
      </p>

      {paso === 'documento' ? (
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="doc" className="text-sm font-semibold text-gray-700">
              Tu número de documento
            </label>
            <input
              id="doc"
              value={documento}
              onChange={(e) => setDocumento(e.target.value.replace(/[^0-9A-Za-z-]/g, ''))}
              inputMode="numeric"
              autoComplete="off"
              className="mt-2 h-14 w-full rounded-xl border-2 border-gray-200 px-4 text-center text-xl tracking-wide focus:border-brand-green focus:outline-none"
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700">¿Por dónde te mandamos el acceso?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['WHATSAPP', 'CORREO'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCanal(c)}
                  className={'h-14 rounded-xl border-2 text-base font-semibold '
                    + (canal === c
                      ? 'border-brand-green bg-brand-green/5 text-brand-green'
                      : 'border-gray-200 text-gray-600')}
                >
                  {c === 'WHATSAPP' ? 'WhatsApp' : 'Correo'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              Tiene que ser el número o el correo que ya está verificado en tu ficha.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void pedir()}
            disabled={cargando || documento.trim().length < 4}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-40"
          >
            <Send className="h-5 w-5" /> {cargando ? 'Pidiendo…' : 'Pedir el acceso'}
          </button>

          <button
            type="button"
            onClick={() => setPaso('pin')}
            className="h-12 w-full text-sm font-semibold text-gray-500 underline"
          >
            Ya tengo el enlace y el PIN
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {aviso && (
            <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{aviso}</p>
          )}
          {!tokenInicial && (
            <div>
              <label htmlFor="token" className="text-sm font-semibold text-gray-700">
                Código del enlace
              </label>
              <input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="mt-2 h-14 w-full rounded-xl border-2 border-gray-200 px-4 font-mono text-base focus:border-brand-green focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Es lo que va después de <span className="font-mono">?t=</span> en el enlace que te
                llegó. Si tocaste el enlace, ya está puesto.
              </p>
            </div>
          )}
          <div>
            <label htmlFor="pin" className="text-sm font-semibold text-gray-700">
              Tu PIN
            </label>
            <input
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="mt-2 h-16 w-full rounded-xl border-2 border-gray-200 text-center font-mono text-3xl tracking-[0.3em] focus:border-brand-green focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => void verificar()}
            disabled={cargando || pin.length < 4 || token.length < 8}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-40"
          >
            <KeyRound className="h-5 w-5" /> {cargando ? 'Entrando…' : 'Entrar'}
          </button>

          <button
            type="button"
            onClick={() => { setPaso('documento'); setError(null) }}
            className="h-12 w-full text-sm font-semibold text-gray-500 underline"
          >
            Pedir otro enlace
          </button>
        </div>
      )}

      {error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    </main>
  )
}
