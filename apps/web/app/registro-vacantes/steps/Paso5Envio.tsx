'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ScanFace, Check } from 'lucide-react'
import { toast } from 'sonner'
import { CapturaFacial, type ResultadoFacial } from '../CapturaFacial'

export function Paso5Envio({
  candidatoId, consentBiometrico,
}: {
  candidatoId?: string | null
  consentBiometrico?: boolean
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
