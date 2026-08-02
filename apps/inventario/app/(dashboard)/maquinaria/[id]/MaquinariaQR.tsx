'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Download, Printer, Loader2 } from 'lucide-react'

const VERDE = '#1B5E20'

export function MaquinariaQR({ id, codigo, nombre }: { id: string; codigo: string; nombre: string }) {
  const [qr, setQr] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  useEffect(() => {
    const base = window.location.origin
    const destino = `${base}/maquinaria/${id}`
    setUrl(destino)
    QRCode.toDataURL(destino, { width: 512, margin: 1, color: { dark: VERDE, light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [id])

  function descargar() {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `QR-${codigo}.png`
    a.click()
  }

  function imprimir() {
    if (!qr) return
    const w = window.open('', '_blank', 'width=420,height=560')
    if (!w) return
    w.document.write(`<!doctype html><html><head><title>Etiqueta ${codigo}</title>
      <style>
        *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
        body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
        .lbl{border:2px solid ${VERDE};border-radius:12px;padding:18px;width:300px;text-align:center}
        .lbl img{width:230px;height:230px}
        .cod{font-size:22px;font-weight:bold;color:${VERDE};letter-spacing:1px;margin-top:6px}
        .nom{font-size:13px;color:#374151;margin-top:2px}
        .org{font-size:10px;color:#9ca3af;margin-top:8px}
      </style></head><body onload="window.print()">
        <div class="lbl">
          <img src="${qr}" alt="QR ${codigo}" />
          <div class="cod">${codigo}</div>
          <div class="nom">${nombre.replace(/</g, '&lt;')}</div>
          <div class="org">Conserjes Inmobiliarios · Maquinaria</div>
        </div>
      </body></html>`)
    w.document.close()
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <p className="font-heading font-semibold text-sm text-gray-800 mb-3 flex items-center gap-1.5">
        <QrCode className="w-4 h-4 text-brand-green" /> Código QR
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="shrink-0 rounded-xl border border-gray-100 p-2 bg-white">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`QR ${codigo}`} className="h-40 w-40" />
          ) : (
            <div className="h-40 w-40 flex items-center justify-center text-gray-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <p className="font-mono text-lg font-bold text-brand-green">{codigo}</p>
          <p className="font-body text-sm text-gray-600">{nombre}</p>
          <p className="font-body text-xs text-gray-400 mt-1 break-all">Al escanear abre la ficha de la máquina.</p>
          <div className="mt-3 flex flex-wrap justify-center sm:justify-start gap-2">
            <button onClick={descargar} disabled={!qr}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <Download className="w-4 h-4" /> Descargar PNG
            </button>
            <button onClick={imprimir} disabled={!qr}
              className="flex items-center gap-1.5 rounded-lg bg-brand-green text-white px-3 py-2 text-sm font-semibold hover:bg-brand-green-dark disabled:opacity-50">
              <Printer className="w-4 h-4" /> Imprimir etiqueta
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
