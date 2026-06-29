'use client'
import { useState, useRef, useCallback } from 'react'
import { Upload, X, Camera, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

interface Props {
  /** Nombre del input oculto que llevará la URL pública al formulario. */
  name?: string
  /** URL inicial (modo edición). */
  defaultUrl?: string | null
  /** Bucket de Storage. */
  bucket?: string
  /** Carpeta dentro del bucket. */
  folder?: string
  label?: string
  /** Se invoca con la URL pública al subir, o null al quitar. */
  onChange?: (url: string | null) => void
}

type State = 'idle' | 'dragging' | 'uploading' | 'success' | 'error'

/**
 * Selector de imagen que la sube a Supabase Storage al instante y expone la
 * URL pública mediante un <input hidden name=...>. No toca la base de datos:
 * la server action del formulario persiste la URL. Sirve para CREAR (sin id)
 * y para EDITAR.
 */
export function ImagePicker({ name = 'imagen_url', defaultUrl = null, bucket = 'productos-fotos', folder = 'nuevos', label = 'Foto del producto', onChange }: Props) {
  const [state, setState] = useState<State>('idle')
  const [url, setUrl] = useState<string | null>(defaultUrl)
  const [preview, setPreview] = useState<string | null>(defaultUrl)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const subir = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setErrorMsg('Solo se permiten imágenes (JPG, PNG, WebP)'); setState('error'); return }
    if (file.size > 5 * 1024 * 1024) { setErrorMsg('La imagen no puede superar 5 MB'); setState('error'); return }

    setState('uploading'); setProgress(0); setErrorMsg('')
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    try {
      const supabase = createClient()
      const tick = setInterval(() => setProgress(p => Math.min(p + 15, 85)), 150)
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()))
      const path = `${folder}/${id}.${ext}`

      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type })
      clearInterval(tick)
      if (error) throw error
      setProgress(100)

      const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path)
      setUrl(publicUrl); setPreview(publicUrl); setState('success')
      onChange?.(publicUrl)
      setTimeout(() => setState('idle'), 2000)
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al subir la imagen')
      setState('error'); setPreview(url)
    }
  }, [bucket, folder, url])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setState('idle')
    const file = e.dataTransfer.files[0]; if (file) subir(file)
  }, [subir])

  function quitar() { setUrl(null); setPreview(null); onChange?.(null) }

  return (
    <div className="space-y-2">
      <p className="font-body font-semibold text-sm text-gray-700">{label}</p>
      <input type="hidden" name={name} value={url ?? ''} />

      <div
        onDragEnter={() => setState('dragging')}
        onDragOver={e => { e.preventDefault(); setState('dragging') }}
        onDragLeave={() => setState('idle')}
        onDrop={onDrop}
        className={`relative rounded-2xl border-2 transition-all duration-200 overflow-hidden
          ${state === 'dragging' ? 'border-brand-green bg-green-50' : 'border-dashed border-gray-200'}
          ${preview ? 'aspect-square max-w-[260px]' : 'aspect-video'}`}
      >
        {preview ? (
          <>
            <Image src={preview} alt="Vista previa" fill className="object-cover" sizes="260px" />
            <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all flex items-center justify-center group">
              <div className="opacity-0 group-hover:opacity-100 flex gap-2 transition-opacity">
                <button type="button" onClick={() => inputRef.current?.click()}
                  className="bg-white text-gray-800 font-body text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-gray-100 shadow-lg">
                  <Camera className="w-3.5 h-3.5" /> Cambiar
                </button>
                <button type="button" onClick={quitar}
                  className="bg-red-500 text-white font-body text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-red-600 shadow-lg">
                  <X className="w-3.5 h-3.5" /> Quitar
                </button>
              </div>
            </div>
            {state === 'success' && (
              <div className="absolute top-3 right-3 bg-green-500 text-white rounded-full p-1.5 shadow-lg">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            )}
            {state === 'uploading' && (
              <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20">
                <div className="h-full bg-brand-green transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
          </>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 cursor-pointer hover:bg-gray-50 transition-colors">
            {state === 'uploading' ? (
              <>
                <Loader2 className="w-8 h-8 text-brand-green animate-spin" />
                <p className="font-body text-sm text-gray-600">Subiendo... {progress}%</p>
              </>
            ) : state === 'dragging' ? (
              <>
                <Upload className="w-10 h-10 text-brand-green" />
                <p className="font-body font-semibold text-brand-green">Suelta la imagen aquí</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="font-body font-semibold text-sm text-gray-700">Arrastra o haz clic para subir</p>
                  <p className="font-body text-xs text-gray-400 mt-1">JPG, PNG, WebP · máx. 5 MB</p>
                </div>
              </>
            )}
          </button>
        )}
      </div>

      {state === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-xs text-red-700">{errorMsg}</p>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) subir(f) }} />
    </div>
  )
}
