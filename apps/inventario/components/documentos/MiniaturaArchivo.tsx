'use client'

import { useEffect, useState } from 'react'
import { FileText, FileImage, File as FileIcon, Maximize2 } from 'lucide-react'

export type TipoArchivo = 'imagen' | 'pdf' | 'otro'

/** Qué se puede mostrar de un archivo según su tipo MIME o su extensión. */
export function tipoArchivo(mime?: string | null, nombre?: string | null): TipoArchivo {
  const m = (mime ?? '').toLowerCase()
  const ext = (nombre ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (/^image\/(jpe?g|png|webp|gif|bmp)$/.test(m) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'imagen'
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  return 'otro'
}

const TAMANOS = { sm: 'h-12 w-10', md: 'h-16 w-14', lg: 'h-24 w-20' } as const

/**
 * Previsualización pequeña de un documento subido: la foto misma, la primera
 * página del PDF (en computador) o un ícono. Al tocarla se abre el visor a
 * pantalla completa (lo decide quien la usa con `onAbrir`).
 */
export function MiniaturaArchivo({
  url, nombre, mime, onAbrir, tamano = 'md',
}: {
  url: string | null
  nombre: string
  mime?: string | null
  onAbrir: () => void
  tamano?: keyof typeof TAMANOS
}) {
  const tipo = tipoArchivo(mime, nombre)
  const [falla, setFalla] = useState(false)
  // Solo en computador se incrusta el PDF: en celulares el navegador lo descargaría.
  const [pdfIncrustado, setPdfIncrustado] = useState(false)
  useEffect(() => { setPdfIncrustado(!window.matchMedia?.('(pointer: coarse)').matches) }, [])

  return (
    <button type="button" onClick={onAbrir} title={`Ver ${nombre}`}
      className={`group relative shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ${TAMANOS[tamano]}`}>
      {!url ? (
        <span className="absolute inset-0 animate-pulse bg-gray-100" />
      ) : tipo === 'imagen' && !falla ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setFalla(true)} className="h-full w-full object-cover" />
      ) : tipo === 'pdf' && pdfIncrustado ? (
        <>
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} title={nombre} tabIndex={-1} loading="lazy"
            className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
            style={{ width: '400%', height: '400%', transform: 'scale(0.25)' }} />
          <span className="absolute bottom-0 left-0 rounded-tr bg-red-600 px-1 text-[8px] font-bold text-white">PDF</span>
        </>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-gray-400">
          {tipo === 'pdf' ? <FileText className="h-5 w-5 text-red-500" /> : tipo === 'imagen' ? <FileImage className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}
          <span className="text-[8px] font-bold uppercase">{(nombre.split('.').pop() ?? '').slice(0, 4)}</span>
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
        <Maximize2 className="h-4 w-4" />
      </span>
    </button>
  )
}
