'use client'

import { useEffect, useRef, useState } from 'react'
import { Video, Upload, Circle, Square, Loader2, X, RotateCcw, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Modo = 'grabar' | 'subir'

/** Captura (grabando o subiendo) el video de despacho y lo sube al bucket privado. */
export function VideoDespacho({ ordenId, onListo, onCancel }: {
  ordenId: string
  onListo: (path: string, mime: string | null) => void
  onCancel: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [modo, setModo] = useState<Modo>('grabar')
  const [grabando, setGrabando] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function iniciarCamara() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: true,
      })
      streamRef.current = stream
      if (liveRef.current) { liveRef.current.srcObject = stream; await liveRef.current.play().catch(() => {}) }
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        .find((m) => MediaRecorder.isTypeSupported(m)) || ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' })
        setBlob(b)
        setPreviewUrl(URL.createObjectURL(b))
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      recRef.current = rec
      rec.start()
      setGrabando(true)
    } catch {
      setError('No se pudo acceder a la cámara/micrófono. Revisa los permisos o usa "Subir archivo".')
    }
  }

  function detener() {
    recRef.current?.stop()
    setGrabando(false)
  }

  function reiniciar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null); setPreviewUrl(null); setError(null)
  }

  function onArchivo(f: File) {
    if (!f.type.startsWith('video/')) { setError('El archivo debe ser un video.'); return }
    reiniciar()
    setBlob(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  async function subir() {
    if (!blob) return
    setSubiendo(true); setError(null)
    try {
      const ext = (blob.type.includes('mp4') ? 'mp4' : 'webm')
      const path = `ordenes/${ordenId}/${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('ordenes-insumo').upload(path, blob, {
        contentType: blob.type || 'video/webm', upsert: false,
      })
      if (upErr) { setError('No se pudo subir el video: ' + upErr.message); return }
      onListo(path, blob.type || null)
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-heading font-bold text-base text-gray-900 flex items-center gap-2">
            <Video className="w-4 h-4 text-brand-green" /> Video de despacho
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Tabs */}
          {!blob && (
            <div className="flex gap-2">
              {([['grabar', 'Grabar', Video], ['subir', 'Subir archivo', Upload]] as const).map(([m, label, Icon]) => (
                <button key={m} onClick={() => { setModo(m); setError(null) }}
                  className={`flex-1 inline-flex items-center justify-center gap-2 font-body text-sm font-semibold px-3 py-2 rounded-xl border transition-colors ${modo === m ? 'bg-green-50 text-brand-green border-brand-green' : 'bg-white text-gray-600 border-gray-200'}`}>
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
          )}

          {error && <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 font-body text-sm text-red-700">{error}</div>}

          {/* Preview del video capturado */}
          {previewUrl ? (
            <video src={previewUrl} controls playsInline className="w-full rounded-xl bg-black aspect-video" />
          ) : modo === 'grabar' ? (
            <div className="space-y-3">
              <video ref={liveRef} muted playsInline className="w-full rounded-xl bg-black aspect-video object-cover" />
              <div className="flex justify-center">
                {!grabando ? (
                  <button onClick={iniciarCamara} className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl">
                    <Circle className="w-4 h-4 fill-white" /> Iniciar grabación
                  </button>
                ) : (
                  <button onClick={detener} className="inline-flex items-center gap-2 bg-gray-900 hover:bg-black text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl animate-pulse">
                    <Square className="w-4 h-4 fill-white" /> Detener
                  </button>
                )}
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 cursor-pointer hover:border-brand-green hover:bg-green-50/40 transition-colors">
              <Upload className="w-8 h-8 text-gray-300" />
              <span className="font-body text-sm text-gray-600">Haz clic para elegir un video</span>
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onArchivo(f) }} />
            </label>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          {blob ? (
            <button onClick={reiniciar} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-gray-700">
              <RotateCcw className="w-4 h-4" /> Repetir
            </button>
          ) : <span />}
          <button onClick={subir} disabled={!blob || subiendo}
            className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Usar y despachar
          </button>
        </div>
      </div>
    </div>
  )
}
