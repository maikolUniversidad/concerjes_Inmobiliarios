'use client'

import { useState } from 'react'
import { ChevronDown, ShieldCheck, ScanFace } from 'lucide-react'
import { AVISO_PRIVACIDAD, CONSENTIMIENTO_DATOS, CONSENTIMIENTO_BIOMETRICO } from '@/lib/registro/consentimientos'

export function Paso0Consentimientos({ onContinuar }: { onContinuar: (biometrico: boolean) => void }) {
  const [datos, setDatos] = useState(false)
  const [bio, setBio] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const toggle = (k: string) => setAbierto((a) => (a === k ? null : k))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-xl font-bold text-gray-900">Antes de empezar</h2>
        <p className="mt-1 text-sm text-gray-500">
          Necesitamos tu permiso para tratar tus datos. Léelo con calma.
        </p>
      </div>

      {/* Aviso de privacidad (desplegable) */}
      <button
        type="button"
        onClick={() => toggle('aviso')}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-left"
      >
        <span className="font-body text-sm font-semibold text-gray-700">Ver aviso de privacidad</span>
        <ChevronDown className={'h-5 w-5 text-gray-400 transition-transform ' + (abierto === 'aviso' ? 'rotate-180' : '')} />
      </button>
      {abierto === 'aviso' && (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-4 font-body text-xs leading-relaxed text-gray-600">
          {AVISO_PRIVACIDAD}
        </pre>
      )}

      {/* Consentimiento OBLIGATORIO — datos personales */}
      <label className="flex cursor-pointer gap-3 rounded-xl border-2 border-gray-200 p-4 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
        <input
          type="checkbox"
          checked={datos}
          onChange={(e) => setDatos(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#2E7D32]"
        />
        <span>
          <span className="flex items-center gap-1.5 font-body text-sm font-semibold text-gray-900">
            <ShieldCheck className="h-4 w-4 text-brand-green" />
            Autorizo el tratamiento de mis datos personales <span className="text-red-500">*</span>
          </span>
          <button type="button" onClick={(e) => { e.preventDefault(); toggle('datos') }}
            className="mt-1 text-xs text-brand-green underline">
            {abierto === 'datos' ? 'Ocultar texto' : 'Leer autorización'}
          </button>
          {abierto === 'datos' && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              {CONSENTIMIENTO_DATOS}
            </pre>
          )}
        </span>
      </label>

      {/* Consentimiento OPCIONAL — biométrico (separado y con peso visual igual) */}
      <label className="flex cursor-pointer gap-3 rounded-xl border-2 border-gray-200 p-4 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
        <input
          type="checkbox"
          checked={bio}
          onChange={(e) => setBio(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#2E7D32]"
        />
        <span>
          <span className="flex items-center gap-1.5 font-body text-sm font-semibold text-gray-900">
            <ScanFace className="h-4 w-4 text-brand-green" />
            Autorizo usar mi rostro para identificarme <span className="text-gray-400">(opcional)</span>
          </span>
          <p className="mt-1 text-xs text-gray-500">
            No estás obligado(a) a autorizar esto. Puedes hacer todo el registro con tu documento de identidad.
          </p>
          <button type="button" onClick={(e) => { e.preventDefault(); toggle('bio') }}
            className="mt-1 text-xs text-brand-green underline">
            {abierto === 'bio' ? 'Ocultar texto' : 'Leer autorización'}
          </button>
          {abierto === 'bio' && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              {CONSENTIMIENTO_BIOMETRICO}
            </pre>
          )}
        </span>
      </label>

      <button
        type="button"
        disabled={!datos}
        onClick={() => onContinuar(bio)}
        className="w-full rounded-xl bg-brand-green py-3.5 font-body text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continuar
      </button>
      {!datos && (
        <p className="text-center text-xs text-gray-400">
          Marca la primera autorización para continuar.
        </p>
      )}
    </div>
  )
}
