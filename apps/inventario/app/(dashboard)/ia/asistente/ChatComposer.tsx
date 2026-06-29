'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Send, Mic, Square, Loader2, StopCircle, Paperclip, X, FileText, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Attachment } from '@/lib/ia/types'
import { ACCEPT_FILES } from '@/lib/ia/parseFiles'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop?: () => void
  streaming: boolean
  disabled?: boolean
  attachments: Attachment[]
  parsing: boolean
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
}

export function ChatComposer({
  value, onChange, onSend, onStop, streaming, disabled,
  attachments, parsing, onAddFiles, onRemoveAttachment,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const puedeEnviar = (value.trim().length > 0 || attachments.length > 0) && !disabled && !parsing

  // Auto-resize del textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [value])

  const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(t => t.stop())

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Tu navegador no permite grabar audio.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stopTracks(stream)
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        if (blob.size < 1200) { setTranscribing(false); return }
        setTranscribing(true)
        try {
          const fd = new FormData()
          const ext = (mr.mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm'
          fd.append('audio', blob, `nota.${ext}`)
          const res = await fetch('/api/ia/transcribe', { method: 'POST', body: fd })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Error de transcripción')
          const texto = (data.texto || '').trim()
          if (texto) {
            onChange(value ? `${value} ${texto}` : texto)
            taRef.current?.focus()
          } else {
            toast.message('No se detectó voz en la grabación.')
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo transcribir el audio.')
        } finally {
          setTranscribing(false)
        }
      }
      mr.start()
      recorderRef.current = mr
      setRecording(true)
    } catch {
      toast.error('No se pudo acceder al micrófono. Revisa los permisos.')
    }
  }, [onChange, value])

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming && puedeEnviar) onSend()
    }
  }

  const pickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onAddFiles(Array.from(list))
  }

  return (
    <div
      className={`border-t border-gray-200 bg-white p-3 sm:p-4 ${dragOver ? 'bg-brand-green/5' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFiles(e.dataTransfer.files) }}
    >
      {/* Chips de adjuntos */}
      {(attachments.length > 0 || parsing) && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
          {attachments.map(a => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-2 pr-1">
              {a.kind === 'image' && a.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.dataUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
              ) : a.kind === 'image' ? (
                <ImageIcon className="h-4 w-4 text-brand-green" />
              ) : (
                <FileText className="h-4 w-4 text-blue-500" />
              )}
              <span className="max-w-[140px] truncate text-xs text-gray-600">{a.name}</span>
              <button
                onClick={() => onRemoveAttachment(a.id)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                aria-label="Quitar adjunto"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {parsing && (
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procesando…
            </div>
          )}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2">
        {/* Adjuntar archivo */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_FILES}
          className="hidden"
          onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={streaming || disabled}
          aria-label="Adjuntar archivo"
          className="shrink-0 h-11 w-11 rounded-xl flex items-center justify-center bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        {/* Micrófono */}
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={transcribing || streaming || disabled}
          aria-label={recording ? 'Detener grabación' : 'Grabar audio'}
          className={[
            'shrink-0 h-11 w-11 rounded-xl flex items-center justify-center transition-colors',
            recording
              ? 'bg-red-500 text-white animate-pulse'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50',
          ].join(' ')}
        >
          {transcribing ? <Loader2 className="h-5 w-5 animate-spin" />
            : recording ? <Square className="h-5 w-5" />
            : <Mic className="h-5 w-5" />}
        </button>

        {/* Textarea */}
        <div className="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/20">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              recording ? 'Grabando… toca el cuadrado para terminar'
              : transcribing ? 'Transcribiendo audio…'
              : 'Escribe, adjunta archivos 📎 o usa el micrófono 🎙️…'
            }
            disabled={disabled}
            className="block w-full resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 leading-relaxed"
          />
        </div>

        {/* Enviar / Detener */}
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Detener respuesta"
            className="shrink-0 h-11 w-11 rounded-xl bg-gray-800 text-white flex items-center justify-center hover:bg-gray-900 transition-colors"
          >
            <StopCircle className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!puedeEnviar}
            aria-label="Enviar"
            className="shrink-0 h-11 w-11 rounded-xl bg-brand-green text-white flex items-center justify-center hover:bg-brand-green-dark transition-colors disabled:opacity-40"
          >
            <Send className="h-5 w-5" />
          </button>
        )}
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-gray-400">
        Adjunta imágenes (las analiza), CSV/Excel o texto. Enter envía · Shift+Enter salto de línea.
      </p>
    </div>
  )
}
