'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ScanFace, Check, KeyRound, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { CapturaFacial, type ResultadoFacial } from '../CapturaFacial'
import type { Credenciales } from '@/lib/registro/datos'

export function Paso5Envio({
  candidatoId, consentBiometrico, credenciales,
}: {
  candidatoId?: string | null
  consentBiometrico?: boolean
  credenciales?: Credenciales | null
}) {
  const [camara, setCamara] = useState(false)
  const [enrolado, setEnrolado] = useState(false)

  function onResultado(r: ResultadoFacial) {
    if (r.disponible === false) {
      toast.info('El registro por rostro no está disponible por ahora.')
      return
    }
    if (r.ok) { setEnrolado(true); toast.success('Registramos tu rostro para agilizar tu próximo ingreso.') }
    else if (r.error) toast.error(r.error)
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-green/10">
        <CheckCircle2 className="h-12 w-12 text-brand-green" />
      </div>
      <h2 className="font-heading text-2xl font-bold text-gray-900">¡Registro enviado!</h2>
      <p className="max-w-sm text-gray-600">
        Recibimos tu hoja de vida. Nuestro equipo de Recursos Humanos la revisará y te
        contactará por <strong>correo</strong> o <strong>WhatsApp</strong> si continúas en el proceso.
      </p>

      {/* Credenciales de acceso a la plataforma */}
      {credenciales && (
        <div className="w-full max-w-sm rounded-xl border border-brand-green/30 bg-brand-green/5 p-4 text-left">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-green">
            <KeyRound className="h-4 w-4" /> Tu acceso a la plataforma
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Con esto puedes volver a ingresar desde cualquier dispositivo para ver tu estado y actualizar tus datos.
          </p>
          <div className="mt-3 space-y-1 font-mono text-sm text-gray-800">
            <p><span className="text-gray-500">Usuario:</span> {credenciales.login_email}</p>
            <p><span className="text-gray-500">Contraseña:</span> {credenciales.password}</p>
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(`Usuario: ${credenciales.login_email}\nContraseña: ${credenciales.password}`)
              toast.success('Credenciales copiadas.')
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-green/40 bg-white px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/5"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar
          </button>
          <p className="mt-2 text-[11px] text-amber-600">Guárdalas. Tu contraseña es tu número de documento.</p>
        </div>
      )}

      {/* Enrolamiento facial opcional (solo si autorizó el biométrico) */}
      {consentBiometrico && candidatoId && (
        <div className="w-full max-w-sm rounded-xl border border-gray-200 p-4 text-left">
          {enrolado ? (
            <p className="flex items-center gap-2 text-sm font-medium text-brand-green">
              <Check className="h-4 w-4" /> Rostro registrado.
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <ScanFace className="h-4 w-4 text-brand-green" /> Registra tu rostro (opcional)
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Así la próxima vez te identificamos más rápido. Puedes omitirlo.
              </p>
              <button onClick={() => setCamara(true)}
                className="mt-3 w-full rounded-lg border border-brand-green py-2.5 text-sm font-semibold text-brand-green hover:bg-brand-green/5">
                Registrar mi rostro
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-2 w-full max-w-sm rounded-xl bg-brand-green-bg/60 p-4 text-left text-sm text-gray-600">
        <p className="font-semibold text-gray-800">¿Qué sigue?</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Verificaremos tus documentos.</li>
          <li>Si eres preseleccionado(a), te pediremos los documentos de vinculación.</li>
          <li>Puedes volver a esta página con tu mismo dispositivo para ver tu estado.</li>
        </ul>
      </div>

      <Link href="/" className="mt-4 rounded-xl bg-brand-green px-6 py-3 font-body font-semibold text-white hover:bg-brand-green-dark">
        Volver al inicio
      </Link>

      {camara && candidatoId && (
        <CapturaFacial modo="enrolar" candidatoId={candidatoId} onResultado={onResultado} onCerrar={() => setCamara(false)} />
      )}
    </div>
  )
}
