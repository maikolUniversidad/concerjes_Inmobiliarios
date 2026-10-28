'use client'

// «Llegué al sitio» de una orden de trabajo.
//
// Esto NO es un botón que ponga el estado: abre la VISITA del motor de F4
// (escaneo de la placa + geocerca) y el estado `EN_SITIO` sale de ahí. La
// diferencia entre «digo que llegué» y «llegué» es el QR, y es la única de las
// marcas de tiempo de la orden que trae una garantía.
//
// La salida para el QR ilegible existe —en campo la placa se raya, se pinta o
// se la llevan— pero exige un motivo y queda marcada como apertura manual, para
// que en el informe se distinga de un escaneo de verdad. Es el mismo trato que
// F4 le da al código impreso.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, ScanLine, Loader2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { BarcodeScanner } from '@/components/ui/BarcodeScanner'
import { Hoja, inputMant, labelMant } from './Hoja'
import { clasificarEscaneoOT } from '@/lib/mantenimiento'

export function AbrirVisitaOT({ ticketId, tienePunto, onListo }: {
  ticketId: string
  /** El activo tiene punto de control. Sin punto no hay visita que abrir. */
  tienePunto: boolean
  onListo: () => void
}) {
  const router = useRouter()
  const [escaneando, setEscaneando] = useState(false)
  const [manual, setManual] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()

  /** La ubicación es opcional: si el dispositivo no la da, la visita se abre y
   *  F4 la marca como dudosa en vez de quedarse sin abrir. */
  function ubicacion(): Promise<{ lat: number | null; lng: number | null; precision: number | null }> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null, precision: null })
      const fin = setTimeout(() => resolve({ lat: null, lng: null, precision: null }), 8000)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(fin)
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy })
        },
        () => { clearTimeout(fin); resolve({ lat: null, lng: null, precision: null }) },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 },
      )
    })
  }

  /**
   * Abre la visita. El CÓDIGO de la placa se le manda a la RPC tal cual
   * (`p_codigo`) y ella lo resuelve contra `ronda_qr`: el token de 21 y el
   * código manual de 8 están impresos en la misma placa y se buscan en
   * columnas distintas, así que resolverlo aquí serían dos caminos donde
   * equivocarse. Antes esta pantalla le pasaba la URL entera y nunca
   * encontraba nada.
   */
  function abrir(codigo: string | null, modo: 'QR' | 'MANUAL', motivoTexto: string | null) {
    startTransition(async () => {
      const u = await ubicacion()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any
      const { data, error } = await sb.rpc('mant_abrir_visita', {
        p_ticket: ticketId,
        // El id de la visita lo genera el dispositivo: así la RPC es
        // idempotente y un reintento no abre dos visitas.
        p_visita: globalThis.crypto?.randomUUID?.() ?? null,
        p_codigo: codigo,
        p_lat: u.lat, p_lng: u.lng, p_precision: u.precision,
        p_motivo_fuera: motivoTexto,
        p_apertura_modo: modo,
        p_inicio_dispositivo: new Date().toISOString(),
      })
      if (error) { toast.error(error.message); return }
      toast.success(
        modo === 'QR'
          ? `Visita ${data?.visita_numero ?? ''} abierta con la placa escaneada.`
          : `Visita ${data?.visita_numero ?? ''} abierta (apertura manual).`,
      )
      setManual(false); setMotivo('')
      onListo(); router.refresh()
    })
  }

  function conCodigo(valor: string) {
    setEscaneando(false)
    const r = clasificarEscaneoOT(valor)

    if (r.tipo === 'EQUIPO') {
      // La placa de un equipo propio de la empresa, no la del activo del
      // cliente. Se dice cuál escaneó en vez de un «no está registrada» que
      // haría pensar que la placa está mala.
      toast.error(`Esa es la placa del equipo ${r.referencia}, de la empresa. Esta orden es sobre un activo del cliente: escanea la placa del activo o la de su punto de control.`)
      return
    }
    if (r.tipo === 'DESCONOCIDO') {
      toast.error('Eso no tiene forma de código de placa. Si la placa está ilegible, usa la apertura manual.')
      return
    }

    // Token o código manual: los dos los resuelve la RPC. El modo lo decide la
    // forma del código, no la pantalla: un manual tecleado no es un escaneo.
    abrir(r.codigo, r.modo, r.modo === 'MANUAL'
      ? 'Código manual de la placa, tecleado o leído sin el QR'
      : null)
  }

  if (!tienePunto) {
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
        Para abrir la visita en sitio, el activo tiene que estar asociado a un punto de control:
        la visita se abre sobre un punto. Asócialo en su ficha.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setEscaneando(true)} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          Llegué: escanear la placa
        </button>
        <button onClick={() => setManual(true)} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-brand-green hover:text-brand-green disabled:opacity-50">
          <PenLine className="w-4 h-4" /> La placa no sirve
        </button>
      </div>
      <p className="mt-1 flex items-start gap-1 text-[11px] text-gray-500">
        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
        Al escanear se toma la ubicación para validar la geocerca del punto. Si el GPS no responde, la
        visita se abre igual y queda marcada como ubicación dudosa.
      </p>

      {escaneando && (
        <BarcodeScanner onDetected={conCodigo} onClose={() => setEscaneando(false)} />
      )}

      {manual && (
        <Hoja abierta titulo="Abrir la orden sin escanear" onClose={() => setManual(false)}
          pie={
            <button
              onClick={() => {
                if (!motivo.trim()) { toast.error('Escribe por qué no se pudo escanear.'); return }
                abrir(null, 'MANUAL', motivo.trim())
              }}
              disabled={pending}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
              {pending && <Loader2 className="w-4 h-4 animate-spin" />} Abrir como apertura manual
            </button>
          }>
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            Esta apertura queda marcada como <b>manual</b> en la orden y en el informe, separada de las
            que sí se escanearon. No es un castigo: es para que el indicador de «llegó al sitio» no
            mezcle lo verificado con lo declarado.
          </p>
          <div>
            <label className={labelMant}>¿Por qué no se pudo escanear? <span className="text-red-500">*</span></label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
              className={`${inputMant} resize-none`}
              placeholder="La placa está pintada, arrancada, el equipo está en un ducto sin señal…" />
          </div>
        </Hoja>
      )}
    </>
  )
}
