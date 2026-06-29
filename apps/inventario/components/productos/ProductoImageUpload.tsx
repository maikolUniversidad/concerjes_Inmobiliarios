'use client'
import { useState, useRef, useCallback } from 'react'
import { Upload, X, Camera, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'

interface Props {
  productoId: string
  currentImageUrl: string | null
  productoNombre: string
  onUploadComplete: (url: string) => void
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error'

export function ProductoImageUpload({ productoId, currentImageUrl, productoNombre, onUploadComplete }: Props) {
  const [state, setState] = useState<UploadState>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Solo se permiten imágenes (JPG, PNG, WebP)')
      setState('error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('La imagen no puede superar 5 MB')
      setState('error')
      return
    }

    setState('uploading')
    setProgress(0)
    setErrorMsg('')

    // Preview local inmediato
    const reader = new FileReader()
    reader.onload = e => setPreviewUrl(e.target?.result as string)
    reader.readAsDataURL(file)

    try {
      // Simular progreso mientras sube
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 15, 85))
      }, 150)

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${productoId}/foto-principal.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('productos-fotos')
        .upload(path, file, { upsert: true, contentType: file.type })

      clearInterval(progressInterval)

      if (uploadError) throw uploadError

      setProgress(100)

      // Obtener URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('productos-fotos')
        .getPublicUrl(path)

      // Actualizar imagen_url en la tabla productos
      const sb = supabase as ReturnType<typeof import('@/lib/supabase/client').createClient>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (sb as any)
        .from('productos')
        .update({ imagen_url: publicUrl })
        .eq('id', productoId)

      if (updateError) throw updateError

      setState('success')
      setPreviewUrl(publicUrl)
      onUploadComplete(publicUrl)

      setTimeout(() => setState('idle'), 2500)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al subir la imagen'
      setErrorMsg(msg)
      setState('error')
      setPreviewUrl(currentImageUrl)
    }
  }, [productoId, currentImageUrl, supabase, onUploadComplete])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setState('idle')
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  const handleRemove = async () => {
    if (!previewUrl) return
    try {
      const path = `${productoId}/foto-principal`
      await supabase.storage.from('productos-fotos').remove([
        `${path}.jpg`, `${path}.png`, `${path}.webp`
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('productos').update({ imagen_url: null }).eq('id', productoId)
      setPreviewUrl(null)
      onUploadComplete('')
    } catch {}
  }

  return (
    <div className="space-y-3">
      <p className="font-body font-semibold text-sm text-gray-700">Foto del producto</p>

      {/* Zona de drop / preview */}
      <div
        onDragEnter={() => setState('dragging')}
        onDragOver={e => { e.preventDefault(); setState('dragging') }}
        onDragLeave={() => setState('idle')}
        onDrop={handleDrop}
        className={`relative rounded-2xl border-2 transition-all duration-200 overflow-hidden
          ${state === 'dragging' ? 'border-brand-green bg-green-50 scale-[1.02]' : 'border-dashed border-gray-200'}
          ${previewUrl ? 'aspect-square' : 'aspect-video'}
        `}
      >
        {previewUrl ? (
          <>
            <Image
              src={previewUrl}
              alt={productoNombre}
              fill
              className="object-cover"
              sizes="(max-width: 400px) 100vw, 400px"
            />
            {/* Overlay al hacer hover */}
            <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all duration-200 flex items-center justify-center group">
              <div className="opacity-0 group-hover:opacity-100 flex gap-2 transition-opacity">
                <button
                  onClick={() => inputRef.current?.click()}
                  className="bg-white text-gray-800 font-body text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-gray-100 shadow-lg"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Cambiar
                </button>
                <button
                  onClick={handleRemove}
                  className="bg-red-500 text-white font-body text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-red-600 shadow-lg"
                >
                  <X className="w-3.5 h-3.5" />
                  Quitar
                </button>
              </div>
            </div>
            {/* Badge de estado */}
            {state === 'success' && (
              <div className="absolute top-3 right-3 bg-green-500 text-white rounded-full p-1.5 shadow-lg animate-bounce">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            )}
          </>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            {state === 'uploading' ? (
              <>
                <Loader2 className="w-8 h-8 text-brand-green animate-spin" />
                <p className="font-body text-sm text-gray-600">Subiendo imagen... {progress}%</p>
                <div className="w-full max-w-[160px] bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-brand-green h-1.5 rounded-full transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : state === 'dragging' ? (
              <>
                <Upload className="w-10 h-10 text-brand-green" />
                <p className="font-body font-semibold text-brand-green">Suelta la imagen aquí</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                  <Camera className="w-7 h-7 text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="font-body font-semibold text-sm text-gray-700">
                    Arrastra o haz clic para subir
                  </p>
                  <p className="font-body text-xs text-gray-400 mt-1">
                    JPG, PNG, WebP · máx. 5 MB
                  </p>
                </div>
              </>
            )}
          </button>
        )}

        {/* Barra de progreso cuando hay imagen previa */}
        {state === 'uploading' && previewUrl && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20">
            <div
              className="h-full bg-brand-green transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Error */}
      {state === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-xs text-red-700">{errorMsg}</p>
        </div>
      )}

      {/* Input oculto */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}
