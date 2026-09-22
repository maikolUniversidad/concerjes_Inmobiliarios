'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Camera, RefreshCw, Check, UserSquare2 } from 'lucide-react'
import { archivoFoto, carnetDesde } from '@/lib/registro/foto'

/**
 * Cámara para la foto de perfil (tipo carné). Muestra la guía del rostro,
 * deja revisar la foto antes de usarla y entrega un JPEG vertical 3:4.
 * Sirve con la cámara del celular del candidato o con la de la oficina.
 */
export function CamaraFoto({
  onFoto, onCerrar, titulo = 'Foto de perfil',
}: {
  onFoto: (f: File) => void | Promise<void>
  onCerrar: () => void
  titulo?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [estado, setEstado] = useState<'iniciando' | 'listo' | 'revisar' | 'guardando' | 'error'>('iniciando')
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        })
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
        setEstado('listo')
      } catch {
        setError('No pudimos abrir la cámara. Revisa que el navegador tenga permiso para usarla, o sube una foto desde el equipo.')
        setEstado('error')
      }
    })()
    return () => {
      vivo = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // La URL de la vista previa se libera al cambiarla o al cerrar.
  useEffect(() => () => { if (foto) URL.revokeObjectURL(foto.url) }, [foto])

  function cerrar() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onCerrar()
  }

  async function capturar() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    setError(null)
    try {
      const blob = await carnetDesde(v, v.videoWidth, v.videoHeight)
      setFoto({ blob, url: URL.createObjectURL(blob) })
      setEstado('revisar')
    } catch {
      setError('No se pudo tomar la foto. Intenta de nuevo.')
    }
  }

  async function usar() {
    if (!foto) return
    setEstado('guardando')
    streamRef.current?.getTracks().forEach((t) => t.stop())
    try {
      await onFoto(archivoFoto(foto.blob))
    } finally {
      onCerrar()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="flex items-center gap-2 font-heading text-sm font-bold text-gray-900">
            <UserSquare2 className="h-4 w-4 text-brand-green" /> {titulo}
          </span>
          <button type="button" onClick={cerrar} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Vertical 3:4, igual al recorte que se guarda: lo que se ve es lo que queda. */}
        <div className="relative mx-auto aspect-[3/4] max-h-[60vh] bg-gray-900">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted autoPlay
            className={'h-full w-full object-cover ' + (estado === 'revisar' || estado === 'guardando' ? 'invisible' : '')} />
          {foto && (estado === 'revisar' || estado === 'guardando') && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto.url} alt="Tu foto" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {estado === 'listo' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[62%] w-[64%] -translate-y-[6%] rounded-[50%] border-2 border-white/80" />
            </div>
          )}
          {(estado === 'iniciando' || estado === 'guardando') && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 text-white">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          )}
        </div>

        <div className="space-y-3 p-4">
          {estado === 'revisar' ? (
            <p className="text-center text-xs text-gray-500">¿Se ve bien? Esta foto sale en la hoja de vida y en los formatos.</p>
          ) : estado !== 'error' ? (
            <p className="text-center text-xs text-gray-500">
              De frente, con buena luz y fondo claro. Sin gorra, tapabocas ni gafas oscuras.
            </p>
          ) : null}
          {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">{error}</p>}

          {estado === 'revisar' || estado === 'guardando' ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setFoto(null); setEstado('listo'); void videoRef.current?.play() }}
                disabled={estado === 'guardando'}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 disabled:opacity-50">
                <RefreshCw className="h-4 w-4" /> Tomar otra
              </button>
              <button type="button" onClick={usar} disabled={estado === 'guardando'}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-green py-3 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
                {estado === 'guardando' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Usar esta foto
              </button>
            </div>
          ) : estado === 'error' ? (
            <button type="button" onClick={cerrar} className="w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700">
              Cerrar
            </button>
          ) : (
            <button type="button" onClick={capturar} disabled={estado !== 'listo'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
              <Camera className="h-5 w-5" /> Tomar foto
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
