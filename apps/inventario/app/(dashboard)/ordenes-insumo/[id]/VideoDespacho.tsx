'use client'

import { useEffect, useRef, useState } from 'react'
import { Video, Upload, Circle, Square, Loader2, X, RotateCcw, Check, AlertTriangle, Camera } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { duracionDeVideo, VIDEO_MIN_SEGUNDOS } from '@/lib/video'

type Modo = 'grabar' | 'subir'
/** inactiva → abriendo (permiso + cámara) → lista (ya hay imagen) → grabando. */
type EstadoCamara = 'inactiva' | 'abriendo' | 'lista' | 'grabando'

/**
 * Captura (grabando o subiendo) el video de despacho y lo sube al bucket privado.
 *
 * Encender la cámara y empezar a grabar son DOS pasos a propósito. Cuando eran
 * uno solo, el botón tardaba entre medio segundo y dos en responder —lo que se
 * demora la cámara en abrir— y para entonces ya se había convertido en
 * «Detener»: el segundo clic, el impaciente, mataba la grabación recién nacida.
 * Así se grabaron 100 de los primeros 132 videos, de menos de 50 KB y sin un
 * solo fotograma. Ahora el botón se bloquea mientras la cámara abre, la
 * grabación no arranca hasta que hay imagen de verdad, y un video demasiado
 * corto no se puede subir.
 */
export function VideoDespacho({ ordenId, onListo, onCancel }: {
  ordenId: string
  onListo: (path: string, mime: string | null, duracion: number | null) => void
  onCancel: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [modo, setModo] = useState<Modo>('grabar')
  const [camara, setCamara] = useState<EstadoCamara>('inactiva')
  const [segundos, setSegundos] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [duracion, setDuracion] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const soltarCamara = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => () => {
    soltarCamara()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cronómetro de la grabación: sin él no hay forma de saber si ya se grabó
  // suficiente, que es justo lo que faltaba.
  useEffect(() => {
    if (camara !== 'grabando') return
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [camara])

  /** Paso 1: pedir permiso, abrir la cámara y esperar a que dé imagen. */
  async function encenderCamara() {
    if (camara !== 'inactiva') return
    setError(null)
    setCamara('abriendo')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: true,
      })
      streamRef.current = stream
      const el = liveRef.current
      if (el) {
        el.srcObject = stream
        await el.play().catch(() => {})
        // `getUserMedia` resuelve apenas se concede el permiso, pero la cámara
        // tarda en entregar el primer fotograma. Grabar antes de eso son puros
        // cuadros negros al principio del video.
        if (el.readyState < 2) {
          await new Promise<void>((listo) => {
            const ok = () => { el.removeEventListener('loadeddata', ok); listo() }
            el.addEventListener('loadeddata', ok)
            setTimeout(ok, 3000)   // por si el evento no llega, no dejarlo colgado
          })
        }
      }
      setCamara('lista')
    } catch {
      soltarCamara()
      setCamara('inactiva')
      setError('No se pudo acceder a la cámara o al micrófono. Revisa los permisos del navegador, o usa «Subir archivo».')
    }
  }

  /** Paso 2: grabar. La cámara ya está entregando imagen. */
  function iniciarGrabacion() {
    const stream = streamRef.current
    if (!stream || camara !== 'lista') return
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      .find((m) => MediaRecorder.isTypeSupported(m)) || ''
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = async () => {
      const b = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' })
      soltarCamara()
      setCamara('inactiva')
      const d = await duracionDeVideo(b)
      setBlob(b)
      setDuracion(d)
      setPreviewUrl(URL.createObjectURL(b))
    }
    recRef.current = rec
    // Con `timeslice` los datos se van entregando durante la grabación: si algo
    // corta la captura, lo grabado hasta ese momento no se pierde.
    rec.start(1000)
    setSegundos(0)
    setCamara('grabando')
  }

  function detener() {
    recRef.current?.stop()
  }

  function reiniciar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null); setDuracion(null); setPreviewUrl(null); setError(null); setSegundos(0)
  }

  async function onArchivo(f: File) {
    if (!f.type.startsWith('video/')) { setError('El archivo debe ser un video.'); return }
    reiniciar()
    const d = await duracionDeVideo(f)
    setBlob(f)
    setDuracion(d)
    setPreviewUrl(URL.createObjectURL(f))
  }

  // Un video que no llega al mínimo no prueba que el pedido salió, así que no
  // se deja subir. Cuando no se pudo medir (`null`) se deja pasar: es peor
  // bloquear un despacho real por un archivo que el navegador no supo leer.
  const muyCorto = duracion !== null && duracion < VIDEO_MIN_SEGUNDOS
  const puedeSubir = Boolean(blob) && !muyCorto && !subiendo

  async function subir() {
    if (!blob || muyCorto) return
    setSubiendo(true); setError(null)
    try {
      const ext = (blob.type.includes('mp4') ? 'mp4' : 'webm')
      const path = `ordenes/${ordenId}/${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('ordenes-insumo').upload(path, blob, {
        contentType: blob.type || 'video/webm', upsert: false,
      })
      if (upErr) { setError('No se pudo subir el video: ' + upErr.message); return }
      onListo(path, blob.type || null, duracion)
    } finally {
      setSubiendo(false)
    }
  }

  const reloj = `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="flex items-center gap-2 font-heading text-base font-bold text-gray-900">
            <Video className="h-4 w-4 text-brand-green" /> Video de despacho
          </h3>
          <button onClick={onCancel} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Tabs */}
          {!blob && camara === 'inactiva' && (
            <div className="flex gap-2">
              {([['grabar', 'Grabar', Video], ['subir', 'Subir archivo', Upload]] as const).map(([m, label, Icon]) => (
                <button key={m} onClick={() => { setModo(m); setError(null) }}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 font-body text-sm font-semibold transition-colors ${modo === m ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 bg-white text-gray-600'}`}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          )}

          {error && <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 font-body text-sm text-red-700">{error}</div>}

          {previewUrl ? (
            <div className="space-y-2">
              <video src={previewUrl} controls playsInline className="aspect-video w-full rounded-xl bg-black" />
              {muyCorto ? (
                <div className="flex gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <p className="font-body text-sm text-red-700">
                    El video dura {duracion?.toFixed(1)} s y no sirve como evidencia del despacho.
                    Graba al menos {VIDEO_MIN_SEGUNDOS} segundos mostrando el pedido.
                  </p>
                </div>
              ) : (
                <p className="font-body text-xs text-gray-500">
                  {duracion !== null ? `Duración: ${duracion.toFixed(1)} s` : 'No se pudo medir la duración de este archivo.'}
                </p>
              )}
            </div>
          ) : modo === 'grabar' ? (
            <div className="space-y-3">
              <div className="relative">
                <video ref={liveRef} muted playsInline className="aspect-video w-full rounded-xl bg-black object-cover" />
                {camara === 'abriendo' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/60">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                    <p className="font-body text-sm text-white">Abriendo la cámara…</p>
                  </div>
                )}
                {camara === 'grabando' && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 font-body text-xs font-semibold text-white">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {reloj}
                  </span>
                )}
              </div>

              <div className="flex justify-center">
                {camara === 'inactiva' && (
                  <button onClick={encenderCamara}
                    className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 font-body text-sm font-semibold text-white hover:bg-black">
                    <Camera className="h-4 w-4" /> Encender cámara
                  </button>
                )}
                {camara === 'abriendo' && (
                  <button disabled
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 font-body text-sm font-semibold text-white opacity-60">
                    <Loader2 className="h-4 w-4 animate-spin" /> Abriendo la cámara…
                  </button>
                )}
                {camara === 'lista' && (
                  <button onClick={iniciarGrabacion}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 font-body text-sm font-semibold text-white hover:bg-red-700">
                    <Circle className="h-4 w-4 fill-white" /> Grabar
                  </button>
                )}
                {camara === 'grabando' && (
                  <button onClick={detener} disabled={segundos < VIDEO_MIN_SEGUNDOS}
                    title={segundos < VIDEO_MIN_SEGUNDOS ? `Graba al menos ${VIDEO_MIN_SEGUNDOS} segundos` : undefined}
                    className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 font-body text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50">
                    <Square className="h-4 w-4 fill-white" />
                    {segundos < VIDEO_MIN_SEGUNDOS ? `Detener en ${VIDEO_MIN_SEGUNDOS - segundos} s` : 'Detener'}
                  </button>
                )}
              </div>

              {camara === 'lista' && (
                <p className="text-center font-body text-xs text-gray-500">
                  La cámara ya está lista. Muestra el pedido y pulsa «Grabar».
                </p>
              )}
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-10 transition-colors hover:border-brand-green hover:bg-green-50/40">
              <Upload className="h-8 w-8 text-gray-300" />
              <span className="font-body text-sm text-gray-600">Haz clic para elegir un video</span>
              <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onArchivo(f) }} />
            </label>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
          {blob ? (
            <button onClick={reiniciar} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-gray-700">
              <RotateCcw className="h-4 w-4" /> Repetir
            </button>
          ) : <span />}
          <button onClick={subir} disabled={!puedeSubir}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 font-body text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-50">
            {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Usar y despachar
          </button>
        </div>
      </div>
    </div>
  )
}
