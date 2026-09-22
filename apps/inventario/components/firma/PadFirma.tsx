'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

/**
 * Recuadro para firmar con el dedo (celular) o el mouse.
 *
 * Devuelve un PNG recortado al trazo, en data URL, que el servidor estampa en
 * el documento. Usa eventos de puntero, así funciona igual con dedo, lápiz y
 * mouse, y bloquea el scroll mientras se firma.
 */
export function PadFirma({
  onCambio, alto = 180, deshabilitado = false,
}: {
  onCambio: (dataUrl: string | null) => void
  alto?: number
  deshabilitado?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dibujando = useRef(false)
  const ultimo = useRef<{ x: number; y: number } | null>(null)
  const trazos = useRef(0)
  const [vacio, setVacio] = useState(true)
  // En una ref: si el padre pasa una función nueva en cada render, el lienzo no
  // debe borrarse (antes se reiniciaba al primer trazo).
  const onCambioRef = useRef(onCambio)
  useEffect(() => { onCambioRef.current = onCambio }, [onCambio])

  const ajustar = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    const ancho = c.parentElement?.clientWidth ?? 320
    c.width = Math.floor(ancho * ratio)
    c.height = Math.floor(alto * ratio)
    c.style.width = `${ancho}px`
    c.style.height = `${alto}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
    trazos.current = 0
    setVacio(true)
    onCambioRef.current(null)
  }, [alto])

  useEffect(() => {
    ajustar()
    // En el celular, abrir el teclado o esconder la barra del navegador dispara
    // `resize` sin cambiar el ancho: solo se reinicia si el ancho cambió.
    let anchoPrevio = canvasRef.current?.parentElement?.clientWidth ?? 0
    const onResize = () => {
      const ancho = canvasRef.current?.parentElement?.clientWidth ?? 0
      if (ancho !== anchoPrevio) { anchoPrevio = ancho; ajustar() }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [ajustar])

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function exportar() {
    const c = canvasRef.current
    if (!c || trazos.current === 0) { onCambioRef.current(null); return }
    // Recorta al área firmada para que la imagen no sea un rectángulo en blanco.
    const ctx = c.getContext('2d')
    if (!ctx) return
    const { width, height } = c
    const datos = ctx.getImageData(0, 0, width, height).data
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (datos[(y * width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) { onCambioRef.current(null); return }
    const m = 10
    minX = Math.max(0, minX - m); minY = Math.max(0, minY - m)
    maxX = Math.min(width, maxX + m); maxY = Math.min(height, maxY + m)
    const out = document.createElement('canvas')
    // Tope de ancho para que la imagen pese poco (la firma viaja en el documento).
    const escala = Math.min(1, 600 / (maxX - minX))
    out.width = Math.max(1, Math.round((maxX - minX) * escala))
    out.height = Math.max(1, Math.round((maxY - minY) * escala))
    out.getContext('2d')?.drawImage(c, minX, minY, maxX - minX, maxY - minY, 0, 0, out.width, out.height)
    onCambioRef.current(out.toDataURL('image/png'))
  }

  return (
    <div className="space-y-2">
      <div className={'relative overflow-hidden rounded-xl border-2 border-dashed bg-white ' + (deshabilitado ? 'border-gray-200 opacity-60' : 'border-gray-300')}>
        <canvas
          ref={canvasRef}
          className="block touch-none"
          onPointerDown={(e) => {
            if (deshabilitado) return
            e.currentTarget.setPointerCapture(e.pointerId)
            dibujando.current = true
            ultimo.current = punto(e)
            const ctx = e.currentTarget.getContext('2d')
            if (ctx && ultimo.current) {
              ctx.beginPath()
              ctx.arc(ultimo.current.x, ultimo.current.y, 1.1, 0, Math.PI * 2)
              ctx.fillStyle = '#0f172a'
              ctx.fill()
            }
          }}
          onPointerMove={(e) => {
            if (!dibujando.current || deshabilitado) return
            const p = punto(e)
            const ctx = e.currentTarget.getContext('2d')
            if (ctx && ultimo.current) {
              ctx.beginPath()
              ctx.moveTo(ultimo.current.x, ultimo.current.y)
              ctx.lineTo(p.x, p.y)
              ctx.stroke()
            }
            ultimo.current = p
          }}
          onPointerUp={() => {
            if (!dibujando.current) return
            dibujando.current = false
            ultimo.current = null
            trazos.current += 1
            setVacio(false)
            exportar()
          }}
          onPointerCancel={() => { dibujando.current = false; ultimo.current = null }}
        />
        {vacio && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            Firme aquí con el dedo o el mouse
          </span>
        )}
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-gray-300" />
      </div>
      <button type="button" onClick={ajustar} disabled={deshabilitado || vacio}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
        <Eraser className="h-3.5 w-3.5" /> Borrar y volver a firmar
      </button>
    </div>
  )
}
