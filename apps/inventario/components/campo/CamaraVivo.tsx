'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCcw, X } from 'lucide-react'

/**
 * Cámara EN VIVO: la única forma de tomar una foto cuando el paso lo exige.
 *
 * Por qué no hay `<input type="file" capture>`: ese control abre el selector de
 * archivos en muchos Android, y entonces «cámara en vivo» deja de significar
 * algo. Aquí se abre el flujo de video con `getUserMedia` y la foto se saca del
 * cuadro, así que el archivo nace en este celular y en este momento.
 *
 * Cuando el paso NO exige cámara en vivo, la pantalla de la visita sí ofrece
 * además el selector de archivos; ahí la galería es legítima y queda registrada
 * como `origen = 'GALERIA'`, que es una señal para F13, no una falta.
 *
 * Si la cámara no se puede abrir se dice y se ofrece reintentar. No se cae al
 * selector de archivos a escondidas: la base rechazaría ese archivo
 * (`ronda_evidencias_validar`) y la persona no entendería por qué.
 */
export function CamaraVivo({
  alTomar, alCerrar, ayuda,
}: {
  alTomar: (foto: Blob) => void | Promise<void>
  alCerrar: () => void
  ayuda?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<'pidiendo' | 'listo' | 'error'>('pidiendo')
  const [frontal, setFrontal] = useState(false)
  const [tomando, setTomando] = useState(false)

  useEffect(() => {
    let flujo: MediaStream | null = null
    let vivo = true
    const arrancar = async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: frontal ? 'user' : { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (!vivo) { flujo.getTracks().forEach((t) => t.stop()); return }
        if (video.current) {
          video.current.srcObject = flujo
          await video.current.play().catch(() => null)
        }
        setEstado('listo')
      } catch {
        setEstado('error')
      }
    }
    void arrancar()
    return () => {
      vivo = false
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [frontal])

  async function tomar() {
    const v = video.current
    if (!v || tomando) return
    setTomando(true)
    try {
      const lienzo = document.createElement('canvas')
      lienzo.width = v.videoWidth || 1280
      lienzo.height = v.videoHeight || 960
      lienzo.getContext('2d')?.drawImage(v, 0, 0, lienzo.width, lienzo.height)
      const blob = await new Promise<Blob | null>((r) =>
        lienzo.toBlob((b) => r(b), 'image/jpeg', 0.92))
      if (blob) await alTomar(blob)
    } finally {
      setTomando(false)
    }
  }

  if (estado === 'error') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-semibold text-amber-900">No se pudo abrir la cámara</p>
        <p className="mt-1 text-sm text-amber-800">
          Revisa que le hayas dado permiso de cámara al navegador. Este paso pide la foto tomada en
          el momento, así que no se puede usar una de la galería.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setEstado('pidiendo')}
            className="h-12 flex-1 rounded-xl bg-amber-700 font-bold text-white"
          >
            Volver a intentar
          </button>
          <button
            type="button"
            onClick={alCerrar}
            className="h-12 rounded-xl border border-amber-300 px-4 font-semibold text-amber-900"
          >
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={video} playsInline muted className="aspect-[3/4] w-full object-cover" />
      {ayuda && (
        <p className="absolute inset-x-0 top-0 bg-black/55 p-2.5 text-center text-sm text-white">
          {ayuda}
        </p>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/55 p-3">
        <button
          type="button"
          onClick={alCerrar}
          aria-label="Cerrar la cámara"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <X className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => void tomar()}
          disabled={estado !== 'listo' || tomando}
          className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-brand-green text-white disabled:opacity-50"
          aria-label="Tomar la foto"
        >
          <Camera className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={() => setFrontal((f) => !f)}
          aria-label="Cambiar de cámara"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <RefreshCcw className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
