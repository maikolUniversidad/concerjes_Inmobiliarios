'use client'

import { useEffect, useState } from 'react'
import { X, ZoomIn } from 'lucide-react'

/**
 * Miniatura del producto (foto) para los listados de ítems de las órdenes.
 * Al tocarla, si hay foto, se abre en grande (lightbox) para identificar el
 * producto; se cierra con la X, tocando afuera o con la tecla ESC.
 */
export function ProductoThumb({ url, nombre }: { url?: string | null; nombre?: string | null }) {
  const [abierto, setAbierto] = useState(false)

  // Cerrar con ESC y bloquear el scroll del fondo mientras está abierto.
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [abierto])

  const miniatura = (
    <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-100">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre ?? ''} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm">📦</div>
      )}
    </div>
  )

  // Sin foto: solo el placeholder, no hace nada al tocar.
  if (!url) return miniatura

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAbierto(true) }}
        title="Ver foto en grande"
        aria-label={`Ver foto de ${nombre ?? 'producto'}`}
        className="group relative cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-green/40"
      >
        {miniatura}
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
          <ZoomIn className="h-4 w-4 text-white" />
        </span>
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setAbierto(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </button>

          <figure className="flex max-h-full max-w-3xl flex-col items-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={nombre ?? ''}
              className="max-h-[82vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            {nombre && (
              <figcaption className="mt-3 max-w-full truncate px-4 text-center font-body text-sm text-white/90">
                {nombre}
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </>
  )
}
