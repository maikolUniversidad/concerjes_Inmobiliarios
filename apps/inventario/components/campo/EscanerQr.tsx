'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { codigoDeEscaneo } from '@conserjes/ronda-core'

/**
 * Escáner del QR de la placa, con `BarcodeDetector` nativo.
 *
 * Por qué sin librería: el repositorio no trae ninguna que lea QR (`qrcode`
 * solo los genera y `quagga2` es de códigos de barras 1D), y
 * `BarcodeDetector` es nativo en Chrome de Android, que es el navegador de casi
 * todos estos celulares. Meter un decodificador en JavaScript son ~200 KB más
 * en el bundle de gente con datos prepagados.
 *
 * Y cuando el navegador no lo tiene (iOS por ahora), no se finge: se dice y se
 * manda al código impreso, que para eso existe (ADR-B). Un escáner que no
 * escanea es peor que no tenerlo.
 */
interface DetectorCodigo {
  detect(fuente: CanvasImageSource): Promise<{ rawValue: string }[]>
}
interface VentanaConDetector {
  BarcodeDetector?: new (op?: { formats?: string[] }) => DetectorCodigo
}

export function EscanerQr({
  alLeer, alCerrar,
}: { alLeer: (texto: string) => void; alCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<'pidiendo' | 'leyendo' | 'sin-soporte' | 'sin-permiso'>('pidiendo')

  useEffect(() => {
    const w = globalThis as unknown as VentanaConDetector
    if (!w.BarcodeDetector) { setEstado('sin-soporte'); return }

    let flujo: MediaStream | null = null
    let vivo = true
    let temporizador: number | undefined

    const arrancar = async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        })
        if (!vivo) { flujo.getTracks().forEach((t) => t.stop()); return }
        if (video.current) {
          video.current.srcObject = flujo
          await video.current.play().catch(() => null)
        }
        setEstado('leyendo')
        const det = new w.BarcodeDetector!({ formats: ['qr_code'] })
        const mirar = async () => {
          if (!vivo || !video.current) return
          try {
            const codigos = await det.detect(video.current)
            const valor = codigos[0]?.rawValue
            if (valor) {
              vivo = false
              alLeer(codigoDeEscaneo(valor))
              return
            }
          } catch { /* un cuadro ilegible no es un error: se sigue mirando */ }
          temporizador = window.setTimeout(mirar, 350)
        }
        void mirar()
      } catch {
        setEstado('sin-permiso')
      }
    }
    void arrancar()

    return () => {
      vivo = false
      if (temporizador) window.clearTimeout(temporizador)
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [alLeer])

  if (estado === 'sin-soporte' || estado === 'sin-permiso') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-semibold text-amber-900">
          {estado === 'sin-soporte'
            ? 'Este navegador no puede escanear'
            : 'No se pudo usar la cámara'}
        </p>
        <p className="mt-1 text-sm text-amber-800">
          Escribe abajo los 8 caracteres que están debajo del QR. Abre el mismo punto.
        </p>
        <button
          type="button"
          onClick={alCerrar}
          className="mt-3 h-12 w-full rounded-xl border border-amber-300 font-semibold text-amber-900"
        >
          Entendido
        </button>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={video}
        playsInline
        muted
        className="aspect-[3/4] w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-48 w-48 rounded-2xl border-4 border-white/80" />
      </div>
      <p className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-sm text-white">
        {estado === 'pidiendo' ? 'Pidiendo la cámara…' : 'Apunta al código de la placa'}
      </p>
      <button
        type="button"
        onClick={alCerrar}
        aria-label="Cerrar la cámara"
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <X className="h-6 w-6" />
      </button>
    </div>
  )
}
