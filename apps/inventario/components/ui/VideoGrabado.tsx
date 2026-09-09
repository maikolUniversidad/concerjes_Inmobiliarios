'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { duracionReal, VIDEO_MIN_SEGUNDOS } from '@/lib/video'

interface Props {
  src: string
  /** Duración conocida (segundos). Sirve para avisar antes de darle play. */
  duracion?: number | null
  className?: string
}

/**
 * Reproductor para los videos grabados en el navegador.
 *
 * Hace dos cosas que un `<video>` pelado no hace con estos archivos:
 *
 *  · Arregla el `0:00 / 0:00`. El WebM de MediaRecorder no declara su duración,
 *    así que la barra de progreso nace inservible; `duracionReal` la calcula.
 *  · Avisa cuando el video no tiene nada que mostrar, en vez de dejar un
 *    rectángulo negro mudo que parece un fallo del reproductor. Así se veían los
 *    100 despachos que se grabaron vacíos.
 */
export function VideoGrabado({ src, duracion, className = '' }: Props) {
  const [vacio, setVacio] = useState(false)

  const sospechoso = (duracion !== null && duracion !== undefined && duracion < VIDEO_MIN_SEGUNDOS) || vacio

  return (
    <div className="space-y-2">
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className={`aspect-video w-full rounded-xl bg-black ${className}`}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          duracionReal(el)
          // Sin ancho de imagen no hay pista de video decodificable: el archivo
          // quedó con la cabecera y poco más.
          if (!el.videoWidth) setVacio(true)
        }}
        onError={() => setVacio(true)}
      />
      {sospechoso && (
        <div className="flex gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="font-body text-xs text-amber-900">
            Este video no alcanzó a grabarse
            {duracion ? ` (${duracion.toFixed(1)} s)` : ''}: se ve negro porque no tiene imagen.
            No sirve como evidencia del despacho.
          </p>
        </div>
      )}
    </div>
  )
}
