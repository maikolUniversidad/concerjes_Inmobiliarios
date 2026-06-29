'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Download, Copy, Check, RefreshCw, Printer } from 'lucide-react'

export type BarcodeFormat = 'CODE128' | 'EAN13' | 'QR' | 'CODE39'

interface BarcodeGeneratorProps {
  value: string
  format: BarcodeFormat
  /** Si se pasa, muestra botón "Asignar al producto" */
  onAssign?: (value: string, dataUrl: string) => void
  /** Si se pasa, muestra botón "Imprimir" con estos datos en la etiqueta */
  printLabel?: { titulo?: string | null; subtitulo?: string | null }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export function BarcodeGenerator({ value, format, onAssign, printLabel }: BarcodeGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    if (!value || !canvasRef.current) return
    setError(null)
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      if (format === 'QR') {
        const QRCode = (await import('qrcode')).default
        await QRCode.toCanvas(canvas, value, {
          width: 280, margin: 2,
          color: { dark: '#1a1a1a', light: '#ffffff' },
        })
      } else {
        const JsBarcode = (await import('jsbarcode')).default
        JsBarcode(canvas, value, {
          format,
          width: 2,
          height: 80,
          displayValue: true,
          fontSize: 13,
          fontOptions: 'bold',
          margin: 12,
          background: '#ffffff',
          lineColor: '#1a1a1a',
        })
      }
      setDataUrl(canvas.toDataURL('image/png'))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al generar código')
    }
  }, [value, format])

  useEffect(() => { generate() }, [generate])

  async function handleCopy() {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleDownload() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `codigo_${format}_${value}.png`
    a.click()
  }

  function handlePrint() {
    if (!dataUrl) return
    const titulo = printLabel?.titulo ? `<div class="t">${escapeHtml(printLabel.titulo)}</div>` : ''
    const subtitulo = printLabel?.subtitulo ? `<div class="s">${escapeHtml(printLabel.subtitulo)}</div>` : ''
    const w = window.open('', '_blank', 'width=420,height=620')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta ${escapeHtml(value)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;background:#fff}
  .label{border:1px solid #e5e7eb;border-radius:12px;padding:18px 16px;text-align:center;max-width:340px}
  .t{font-weight:700;font-size:14px;color:#111;margin-bottom:2px;line-height:1.25}
  .s{font-size:12px;color:#666;margin-bottom:10px}
  img{max-width:100%;height:auto;image-rendering:pixelated}
  .v{font-family:'Courier New',monospace;font-size:12px;color:#333;margin-top:8px;word-break:break-all}
  @media print{ body{padding:0} .label{border:none} @page{margin:8mm} }
</style></head>
<body><div class="label">${titulo}${subtitulo}<img src="${dataUrl}" alt="${escapeHtml(value)}"/><div class="v">${escapeHtml(value)}</div></div>
<script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close()},300)}</script>
</body></html>`)
    w.document.close()
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {error ? (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700 font-body text-center">
          {error}
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm max-w-full overflow-x-auto">
          <canvas ref={canvasRef} className="max-w-full h-auto block mx-auto" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button onClick={handleCopy} title="Copiar valor"
          className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors">
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <button onClick={handleDownload} disabled={!dataUrl} title="Descargar PNG"
          className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40">
          <Download className="w-3.5 h-3.5" />
          Descargar
        </button>
        <button onClick={handlePrint} disabled={!dataUrl} title="Imprimir etiqueta"
          className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </button>
        <button onClick={generate} title="Regenerar imagen"
          className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {onAssign && dataUrl && (
          <button onClick={() => onAssign(value, dataUrl)}
            className="flex items-center gap-1.5 bg-brand-green text-white rounded-lg px-3 py-1.5 font-body text-xs font-semibold hover:bg-brand-green-dark transition-colors">
            <Check className="w-3.5 h-3.5" />
            Asignar
          </button>
        )}
      </div>
    </div>
  )
}
