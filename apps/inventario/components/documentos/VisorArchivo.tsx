'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ExternalLink, Download, ZoomIn, ZoomOut, FileWarning, Loader2 } from 'lucide-react'
import { tipoArchivo } from './MiniaturaArchivo'

export interface ArchivoVisible {
  /** URL firmada (null mientras se genera). */
  url: string | null
  nombre: string
  mime?: string | null
  /** Texto corto encima del nombre (p. ej. el tipo de documento). */
  grupo?: string | null
}

/**
 * Visor a pantalla completa de documentos subidos: fotos con zoom y PDF con el
 * lector del navegador. Con varias imágenes se pasa de una a otra con las
 * flechas (también del teclado); Esc cierra.
 */
export function VisorArchivo({ archivos, inicial = 0, onCerrar }: { archivos: ArchivoVisible[]; inicial?: number; onCerrar: () => void }) {
  const [i, setI] = useState(Math.min(Math.max(inicial, 0), Math.max(archivos.length - 1, 0)))
  const [zoom, setZoom] = useState(false)
  const actual = archivos[i]
  const tipo = actual ? tipoArchivo(actual.mime, actual.nombre) : 'otro'
  const hay = archivos.length > 1

  const mover = useCallback((paso: number) => {
    setZoom(false)
    setI((x) => (x + paso + archivos.length) % archivos.length)
  }, [archivos.length])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
      else if (e.key === 'ArrowRight' && hay) mover(1)
      else if (e.key === 'ArrowLeft' && hay) mover(-1)
    }
    window.addEventListener('keydown', tecla)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = overflow }
  }, [onCerrar, mover, hay])

  if (!actual) return null
  const tactil = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={actual.nombre}>
      <div className="flex items-center gap-2 px-3 py-2 text-white sm:px-4">
        <div className="min-w-0 flex-1">
          {actual.grupo && <p className="truncate text-[11px] text-white/60">{actual.grupo}</p>}
          <p className="truncate text-sm font-semibold">{actual.nombre}</p>
        </div>
        {hay && <span className="shrink-0 text-xs text-white/60">{i + 1} de {archivos.length}</span>}
        {tipo === 'imagen' && (
          <button type="button" onClick={() => setZoom((z) => !z)} className="rounded-lg p-2 hover:bg-white/10" title={zoom ? 'Ajustar a la pantalla' : 'Ver en tamaño real'}>
            {zoom ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
          </button>
        )}
        {actual.url && (
          <>
            <a href={actual.url} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 hover:bg-white/10" title="Abrir en otra pestaña"><ExternalLink className="h-5 w-5" /></a>
            <a href={actual.url} download={actual.nombre} className="rounded-lg p-2 hover:bg-white/10" title="Descargar"><Download className="h-5 w-5" /></a>
          </>
        )}
        <button type="button" onClick={onCerrar} className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar"><X className="h-6 w-6" /></button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
        {!actual.url ? (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
        ) : tipo === 'imagen' ? (
          <div className={'h-full w-full ' + (zoom ? 'overflow-auto' : 'flex items-center justify-center p-2 sm:p-6')}
            onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={actual.url} alt={actual.nombre} onClick={() => setZoom((z) => !z)}
              className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'} />
          </div>
        ) : tipo === 'pdf' && !tactil ? (
          <iframe src={actual.url} title={actual.nombre} className="h-full w-full max-w-5xl bg-white" />
        ) : (
          <div className="mx-4 max-w-sm rounded-2xl bg-white p-6 text-center">
            <FileWarning className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm text-gray-700">
              {tipo === 'pdf' ? 'Abre el PDF para leerlo completo.' : 'Este tipo de archivo no se puede ver aquí.'}
            </p>
            <a href={actual.url} target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
              <ExternalLink className="h-4 w-4" /> {tipo === 'pdf' ? 'Abrir el PDF' : 'Descargar el archivo'}
            </a>
          </div>
        )}

        {hay && (
          <>
            <button type="button" onClick={() => mover(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Anterior">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" onClick={() => mover(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Siguiente">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
