'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'

const MAX_FOTO = 12 * 1024 * 1024

/** Selector de fotos: cámara o galería, con vista previa. Solo guarda los File en memoria. */
export function FotosPicker({ fotos, onChange, max = 6 }: { fotos: File[]; onChange: (f: File[]) => void; max?: number }) {
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  function agregar(lista: FileList | null) {
    if (!lista) return
    const nuevas = Array.from(lista).filter((f) => {
      if (!f.type.startsWith('image/')) { toast.error(`"${f.name}" no es una imagen.`); return false }
      if (f.size > MAX_FOTO) { toast.error(`"${f.name}" supera 12 MB.`); return false }
      return true
    })
    const total = [...fotos, ...nuevas]
    if (total.length > max) toast.message(`Máximo ${max} fotos.`)
    onChange(total.slice(0, max))
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {previews.map((src, i) => (
          <div key={src} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
            <button type="button" onClick={() => onChange(fotos.filter((_, j) => j !== i))}
              className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white" aria-label="Quitar foto">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {fotos.length < max && (
          <>
            <button type="button" onClick={() => camRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green">
              <Camera className="h-5 w-5" /><span className="text-[10px] font-medium">Cámara</span>
            </button>
            <button type="button" onClick={() => galRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green">
              <ImagePlus className="h-5 w-5" /><span className="text-[10px] font-medium">Galería</span>
            </button>
          </>
        )}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { agregar(e.target.files); e.target.value = '' }} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { agregar(e.target.files); e.target.value = '' }} />
    </div>
  )
}
