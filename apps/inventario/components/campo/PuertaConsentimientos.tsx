'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { CONSENTIMIENTOS, hashTexto, type TipoConsentimiento } from '@/lib/campo/consentimientos'
import { createClient } from '@/lib/supabase/client'
import { llamarRpc } from '@/lib/campo/rpc'
import type { ActorPwa } from './InicioCampo'

/**
 * Lo que la persona lee y acepta ANTES del primer uso, uno por pantalla.
 *
 * Tres cosas que no son adorno:
 *   · se guarda el TEXTO que leyó y su hash, no solo el «sí». Un consentimiento
 *     sin el texto aceptado no prueba nada (Ley 1581 de 2012);
 *   · decir NO es un botón igual de grande que decir SÍ, y la pantalla explica
 *     qué deja de funcionar sin amenazar. Un «no» escondido no es un no;
 *   · la BIOMETRÍA va de última, marcada como opcional, y negarla no bloquea
 *     nada: se firma con trazo y queda registrado el motivo. Eso lo garantiza
 *     un trigger de la base, no esta pantalla (ADR-02 §5.2).
 */
export function PuertaConsentimientos({
  actor, pedir, obligatorios, alTerminar,
}: {
  actor: ActorPwa
  pedir: TipoConsentimiento[]
  obligatorios: TipoConsentimiento[]
  alTerminar: () => void
}) {
  const lista = CONSENTIMIENTOS.filter((c) => pedir.includes(c.tipo))
  const [i, setI] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actual = lista[i]

  async function responder(otorgado: boolean) {
    if (!actual || guardando) return
    setGuardando(true)
    setError(null)
    const args = {
      p_persona: actor.personaId,
      p_tipo: actual.tipo,
      p_otorgado: otorgado,
      p_version: `${actual.tipo} ${actual.version}`,
      p_hash: await hashTexto(actual.texto),
      p_canal: 'APP',
      p_user_agent: navigator.userAgent.slice(0, 300),
    }
    try {
      if (actor.modo === 'cuenta') {
        await llamarRpc(createClient(), 'persona_consentimiento_registrar', args)
      } else {
        const res = await fetch('/api/campo/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fn: 'persona_consentimiento_registrar', args }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Error')
      }
      if (i + 1 < lista.length) setI(i + 1)
      else alTerminar()
    } catch {
      // Sin red no se puede registrar un consentimiento, y tampoco se debe
      // seguir como si se hubiera registrado: lo que la ley pide es la prueba.
      setError('No se pudo guardar tu respuesta. Necesitas señal una sola vez para esto.')
    } finally {
      setGuardando(false)
    }
  }

  if (!actual) return null
  const esObligatorio = obligatorios.includes(actual.tipo)

  return (
    <main className="px-4 py-6">
      <p className="text-xs uppercase tracking-wide text-gray-400">
        {i + 1} de {lista.length}
      </p>
      <h1 className="font-heading mt-1 text-2xl font-bold leading-tight">{actual.titulo}</h1>
      {!actual.necesario && (
        <span className="mt-2 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
          Opcional
        </span>
      )}

      <p className="mt-4 text-[16px] leading-relaxed text-gray-800">{actual.texto}</p>

      <div className="mt-4 rounded-xl bg-gray-100 p-3 text-sm text-gray-700">
        <p className="font-semibold">Si dices que no:</p>
        <p className="mt-0.5">{actual.siNo}</p>
      </div>

      {error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={() => void responder(true)}
          disabled={guardando}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-50"
        >
          <Check className="h-6 w-6" /> Sí, autorizo
        </button>
        <button
          type="button"
          onClick={() => void responder(false)}
          disabled={guardando}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-gray-300 text-lg font-bold text-gray-700 disabled:opacity-50"
        >
          <X className="h-6 w-6" /> No autorizo
        </button>
      </div>

      {esObligatorio && (
        <p className="mt-4 text-center text-xs text-gray-500">
          Sin esto no se pueden hacer las tareas que piden foto. Puedes decir que no y hablar con tu
          supervisor.
        </p>
      )}
    </main>
  )
}
