'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Camera, ScanFace, RefreshCw } from 'lucide-react'
import { getSupabase, ensureAnonSession } from '@/lib/supabase/client'

export interface ResultadoFacial {
  disponible?: boolean
  resultado?: 'MATCH' | 'DUDA' | 'NO_MATCH' | 'LIVENESS_FAIL'
  candidato_id?: string | null
  ok?: boolean
  error?: string
}

interface Props {
  modo: 'identificar' | 'enrolar'
  candidatoId?: string
  onResultado: (r: ResultadoFacial) => void
  onCerrar: () => void
}

export function CapturaFacial({ modo, candidatoId, onResultado, onCerrar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [estado, setEstado] = useState<'iniciando' | 'listo' | 'capturando' | 'error'>('iniciando')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setEstado('listo')
      } catch {
        setError('No pudimos abrir la cámara. Da permiso o usa tu documento.')
        setEstado('error')
      }
    })()
    return () => {
      vivo = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function cerrar() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onCerrar()
  }

  async function capturar() {
    const video = videoRef.current
    if (!video) return
    setEstado('capturando')
    setError(null)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = canvas.toDataURL('image/jpeg', 0.85)

      await ensureAnonSession()
      const sb = getSupabase()
      const { data: s } = await sb.auth.getSession()
      const endpoint = modo === 'identificar' ? '/api/registro/facial/identify' : '/api/registro/facial/enroll'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
        body: JSON.stringify(modo === 'identificar' ? { image } : { candidato_id: candidatoId, image }),
      })
      const j: ResultadoFacial = await res.json()

      if (j.disponible === false) { onResultado(j); cerrar(); return }
      if (j.resultado === 'LIVENESS_FAIL') {
        setError('No pudimos verificar que sea una persona real. Busca mejor luz e inténtalo otra vez.')
        setEstado('listo'); return
      }
      onResultado(j)
      cerrar()
    } catch {
      setError('Ocurrió un error. Intenta de nuevo o usa tu documento.')
      setEstado('listo')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="flex items-center gap-2 font-heading text-sm font-bold text-gray-900">
            <ScanFace className="h-4 w-4 text-brand-green" />
            {modo === 'identificar' ? 'Identifícate con tu rostro' : 'Registra tu rostro'}
          </span>
          <button onClick={cerrar} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="relative aspect-[4/3] bg-gray-900">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {/* Guía oval */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-44 rounded-[50%] border-2 border-white/70" />
          </div>
          {estado === 'iniciando' && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/60 text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <div className="space-y-3 p-4">
          <p className="text-center text-xs text-gray-500">
            Centra tu cara en el óvalo, con buena luz y sin gorra ni tapabocas.
          </p>
          {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">{error}</p>}

          {estado === 'error' ? (
            <button onClick={cerrar} className="w-full rounded-xl border border-gray-300 py-3 font-body font-semibold text-gray-600">
              Usar mi documento
            </button>
          ) : (
            <button
              onClick={capturar}
              disabled={estado !== 'listo'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50"
            >
              {estado === 'capturando' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {estado === 'capturando' ? 'Verificando…' : 'Tomar foto'}
            </button>
          )}
          <button onClick={cerrar} className="flex w-full items-center justify-center gap-1 text-xs text-gray-400">
            {modo === 'enrolar' ? 'Omitir por ahora' : <><RefreshCw className="h-3 w-3" /> Prefiero usar mi documento</>}
          </button>
        </div>
      </div>
    </div>
  )
}
