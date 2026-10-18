'use client'

import { useEffect, useMemo } from 'react'
import { FileText, Film, Upload, X } from 'lucide-react'

/**
 * Archivos elegidos/pegados que aún no se envían: miniatura si es imagen,
 * ícono si no, y botón para quitar. Va encima del cuadro de texto.
 */
export function ArchivosPendientes({ archivos, onQuitar, oscuro = false }: {
  archivos: File[]
  onQuitar: (indice: number) => void
  oscuro?: boolean
}) {
  const urls = useMemo(() => archivos.map((f) => f.type.startsWith('image/') ? URL.createObjectURL(f) : null), [archivos])
  useEffect(() => () => { urls.forEach((u) => u && URL.revokeObjectURL(u)) }, [urls])

  if (archivos.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {archivos.map((f, i) => (
        <div key={`${f.name}-${f.size}-${i}`}
          className={`group relative flex items-center gap-1.5 rounded-lg border py-1 pl-1 pr-6 ${oscuro ? 'border-white/20 bg-white/10 text-white' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
          {urls[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[i]!} alt={f.name} className="h-10 w-10 rounded object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded bg-white/60">
              {f.type.startsWith('video/') ? <Film className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </span>
          )}
          <span className="max-w-[130px] truncate text-[11px]">{f.name}</span>
          <button type="button" onClick={() => onQuitar(i)} aria-label={`Quitar ${f.name}`}
            className="absolute right-1 top-1 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-red-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Velo que aparece al arrastrar archivos sobre la zona. */
export function VeloSoltar({ visible, texto = 'Suelta para adjuntar' }: { visible: boolean; texto?: string }) {
  if (!visible) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-brand-green bg-brand-green/10 backdrop-blur-[1px]">
      <span className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-green shadow">
        <Upload className="h-4 w-4" /> {texto}
      </span>
    </div>
  )
}
