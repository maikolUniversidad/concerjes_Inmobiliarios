'use client'
// Pegar (Ctrl+V) y arrastrar archivos en cualquier chat o formulario con adjuntos.
// Uso: const { arrastrando, zona } = useAdjuntosPegables(agregarArchivos)
//      <div {...zona}> … <textarea /> … </div>
// El pegado de texto normal no se toca: solo se intercepta si trae archivos.
import { useCallback, useEffect, useRef, useState } from 'react'

const EXT_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'text/plain': 'txt',
}

/** Las capturas pegadas llegan como "image.png": se renombran con fecha y hora. */
function renombrar(f: File, i: number): File {
  if (f.name && !/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) return f
  const ext = EXT_MIME[f.type] ?? (f.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5)
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const sello = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return new File([f], `captura-${sello}${i ? `-${i + 1}` : ''}.${ext}`, { type: f.type, lastModified: f.lastModified })
}

/** Archivos que trae un evento de pegado (capturas, imágenes copiadas, archivos copiados del explorador). */
export function archivosDelPortapapeles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const desdeItems = Array.from(dt.items ?? [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  const lista = desdeItems.length > 0 ? desdeItems : Array.from(dt.files ?? [])
  return lista.map(renombrar)
}

export function useAdjuntosPegables(onArchivos: (files: File[]) => void, deshabilitado = false) {
  const [arrastrando, setArrastrando] = useState(false)
  const profundidad = useRef(0)
  const cb = useRef(onArchivos)
  useEffect(() => { cb.current = onArchivos }, [onArchivos])

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (deshabilitado) return
    const files = archivosDelPortapapeles(e.clipboardData)
    if (files.length === 0) return
    e.preventDefault()
    cb.current(files)
  }, [deshabilitado])

  const tieneArchivos = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (deshabilitado || !tieneArchivos(e)) return
    e.preventDefault()
    profundidad.current += 1
    setArrastrando(true)
  }, [deshabilitado])
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (deshabilitado || !tieneArchivos(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [deshabilitado])
  const onDragLeave = useCallback(() => {
    profundidad.current = Math.max(0, profundidad.current - 1)
    if (profundidad.current === 0) setArrastrando(false)
  }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    if (deshabilitado || !tieneArchivos(e)) return
    e.preventDefault()
    profundidad.current = 0
    setArrastrando(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) cb.current(files)
  }, [deshabilitado])

  return { arrastrando, zona: { onPaste, onDragEnter, onDragOver, onDragLeave, onDrop } }
}
