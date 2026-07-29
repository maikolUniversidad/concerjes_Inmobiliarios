'use client'

import { useRef, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  onChange: (base64: string | null) => void
  height?: number
}

export default function FirmaDigital({ onChange, height = 160 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dibujando = useRef(false)
  const [vacia, setVacia] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Fondo blanco
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function iniciar(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    dibujando.current = true
    const ctx = canvas.getContext('2d')!
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function dibujar(e: React.MouseEvent | React.TouchEvent) {
    if (!dibujando.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const ctx = canvas.getContext('2d')!
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    if (vacia) {
      setVacia(false)
      onChange(canvas.toDataURL('image/png'))
    } else {
      onChange(canvas.toDataURL('image/png'))
    }
  }

  function terminar() {
    dibujando.current = false
  }

  function limpiar() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setVacia(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl overflow-hidden bg-white"
        style={{ height }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={height * 2}
          className="w-full h-full touch-none cursor-crosshair"
          onMouseDown={iniciar}
          onMouseMove={dibujar}
          onMouseUp={terminar}
          onMouseLeave={terminar}
          onTouchStart={iniciar}
          onTouchMove={dibujar}
          onTouchEnd={terminar}
        />
        {vacia && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-gray-400">Firme aquí con el dedo o el ratón</p>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={limpiar}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" /> Limpiar firma
      </button>
    </div>
  )
}
