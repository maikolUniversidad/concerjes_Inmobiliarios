'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera, X, Flashlight, ScanLine, AlertCircle } from 'lucide-react'

interface BarcodeScannerProps {
  onDetected: (value: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<unknown>(null)
  const rafRef = useRef<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [supportsTorch, setSupportsTorch] = useState(false)
  const [manualInput, setManualInput] = useState('')

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setScanning(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      // Check torch support
      const track = stream.getVideoTracks()[0]
      const caps = track.getCapabilities() as Record<string, unknown>
      if (caps?.torch) setSupportsTorch(true)

      // BarcodeDetector API (Chrome / Edge / Android)
      const BD = (window as unknown as Record<string, unknown>).BarcodeDetector as (new (opts: unknown) => unknown) | undefined
      if (BD) {
        detectorRef.current = new BD({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e', 'data_matrix'],
        })
        const detect = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            rafRef.current = requestAnimationFrame(detect); return
          }
          try {
            const barcodes = await (detectorRef.current as { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }).detect(videoRef.current)
            if (barcodes.length > 0) {
              const val = barcodes[0].rawValue
              setLastScan(val)
              stopCamera()
              setScanning(false)
              onDetected(val)
              return
            }
          } catch {}
          rafRef.current = requestAnimationFrame(detect)
        }
        rafRef.current = requestAnimationFrame(detect)
      } else {
        setError('Tu navegador no soporta detección automática de códigos. Usa el campo manual.')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Permiso de cámara denegado. Permite el acceso en la configuración del navegador.')
      } else {
        setError('No se pudo acceder a la cámara: ' + msg)
      }
      setScanning(false)
    }
  }, [onDetected, stopCamera])

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const newVal = !torchOn
    await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({ advanced: [{ torch: newVal }] })
    setTorchOn(newVal)
  }

  function handleManual(e: React.FormEvent) {
    e.preventDefault()
    if (manualInput.trim()) {
      stopCamera()
      onDetected(manualInput.trim())
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-brand-green" />
          <span className="font-heading font-bold text-white text-sm">Escanear código</span>
        </div>
        <div className="flex items-center gap-2">
          {supportsTorch && (
            <button onClick={toggleTorch}
              className={`p-2 rounded-lg transition-colors ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/10 text-white'}`}
              title="Linterna">
              <Flashlight className="w-5 h-5" />
            </button>
          )}
          <button onClick={() => { stopCamera(); onClose() }}
            className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

        {/* Scan overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-72 h-44">
            {/* Corners */}
            {[
              'top-0 left-0 border-t-4 border-l-4 rounded-tl-xl',
              'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
              'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl',
              'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl',
            ].map((cls, i) => (
              <div key={i} className={`absolute w-8 h-8 border-brand-green ${cls}`} />
            ))}
            {/* Scan line */}
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
              <div className="h-0.5 bg-brand-green/80 animate-pulse shadow-[0_0_8px_2px_rgba(46,125,50,0.6)]" />
            </div>
          </div>
          <p className="absolute bottom-16 left-0 right-0 text-center font-body text-sm text-white/70">
            {scanning ? 'Apunta la cámara al código de barras o QR' : lastScan ? `✓ Detectado: ${lastScan}` : ''}
          </p>
        </div>

        {/* Dark overlay edges */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 280px 160px at center, transparent 70%, rgba(0,0,0,0.65) 100%)' }} />
      </div>

      {/* Bottom: error + manual input */}
      <div className="bg-gray-950 px-4 py-4 space-y-3 shrink-0">
        {error && (
          <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="font-body text-xs text-red-300">{error}</p>
          </div>
        )}
        <form onSubmit={handleManual} className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-3 py-2">
            <ScanLine className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              placeholder="Ingresa el código manualmente..."
              className="flex-1 bg-transparent font-body text-sm text-white placeholder:text-gray-500 outline-none"
              autoComplete="off"
            />
          </div>
          <button type="submit"
            className="bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-xl hover:bg-brand-green-dark transition-colors disabled:opacity-50"
            disabled={!manualInput.trim()}>
            OK
          </button>
        </form>
      </div>
    </div>
  )
}
