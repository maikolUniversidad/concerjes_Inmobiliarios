'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import {
  ArrowLeft, Maximize2, Download, FileText, Loader2, ShieldCheck,
  IdCard, Phone, Briefcase, Building2, MapPin, X, QrCode as QrIcon,
} from 'lucide-react'

export interface CarnetData {
  id: string
  nombre: string
  email: string
  rol: string
  telefono: string | null
  avatar_url: string | null
  tipo_doc: string | null
  documento: string | null
  cargo: string | null
  empresa: string | null
  sede: string | null
  grupo: string | null
  estado: string
  fecha_ingreso: string | null
  creado: string | null
  org: { nombre: string; razon: string; nit: string; web: string }
}

const VERDE = '#2E7D32'
const VERDE_OSCURO = '#1B5E20'

function iniciales(nombre: string) {
  return nombre.trim().split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase()
}

function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Descarga un data URL como archivo. */
function descargar(dataUrl: string, nombre: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function fetchDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const b = await r.blob()
    return await new Promise((res) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result as string)
      fr.onerror = () => res(null)
      fr.readAsDataURL(b)
    })
  } catch {
    return null
  }
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => res(null)
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// ─── Tarjeta (vista) ──────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-brand-green shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-body text-[10px] uppercase tracking-wide text-gray-400 leading-none">{label}</p>
        <p className="font-body text-sm font-medium text-gray-800 truncate mt-0.5">{value}</p>
      </div>
    </div>
  )
}

function CarnetCard({ data, qrUrl }: { data: CarnetData; qrUrl: string | null }) {
  const docTxt = data.documento ? `${data.tipo_doc ?? 'CC'} ${data.documento}` : null
  const rows = [
    docTxt && { icon: <IdCard className="w-4 h-4" />, label: 'Documento', value: docTxt },
    data.cargo && { icon: <Briefcase className="w-4 h-4" />, label: 'Cargo', value: data.cargo },
    data.empresa && { icon: <Building2 className="w-4 h-4" />, label: 'Empresa usuaria', value: data.empresa },
    data.sede && { icon: <MapPin className="w-4 h-4" />, label: 'Sede', value: data.sede },
    data.telefono && { icon: <Phone className="w-4 h-4" />, label: 'Teléfono', value: data.telefono },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[]

  return (
    <div className="w-full max-w-[360px] mx-auto rounded-3xl overflow-hidden bg-white border border-gray-200 shadow-xl">
      {/* Header */}
      <div className="relative h-28" style={{ background: `linear-gradient(135deg, ${VERDE_OSCURO}, ${VERDE})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-blanco.png" alt="Conserjes Inmobiliarios" className="absolute left-4 top-4 h-7 w-auto object-contain" />
        <span className="absolute right-4 top-4 font-body text-[10px] font-semibold uppercase tracking-widest text-white/80">Carnet</span>
        {/* Avatar */}
        <div className="absolute left-1/2 -bottom-11 -translate-x-1/2">
          <div className="h-24 w-24 rounded-2xl border-4 border-white bg-brand-green overflow-hidden shadow-md flex items-center justify-center">
            {data.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.avatar_url} alt={data.nombre} className="h-full w-full object-cover" />
            ) : (
              <span className="font-heading font-bold text-2xl text-white">{iniciales(data.nombre)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="pt-14 px-5 pb-5 text-center">
        <h2 className="font-heading font-bold text-lg text-gray-900 leading-tight">{data.nombre}</h2>
        <span className="inline-flex items-center gap-1 mt-1.5 font-body text-xs font-semibold text-brand-green bg-green-50 px-3 py-1 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5" /> {data.rol}
        </span>

        {rows.length > 0 && (
          <div className="mt-4 text-left rounded-2xl border border-gray-100 bg-gray-50/50 px-3">
            {rows.map((r) => <InfoRow key={r.label} {...r} />)}
          </div>
        )}

        {/* QR */}
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <div className="rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
            {qrUrl
              ? <img src={qrUrl} alt="QR de verificación" className="h-28 w-28" />
              : <div className="h-28 w-28 flex items-center justify-center text-gray-300"><QrIcon className="w-8 h-8" /></div>}
          </div>
          <p className="font-body text-[10px] text-gray-400">Escanea para verificar identidad</p>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
          <span className={`font-body text-[10px] font-semibold px-2 py-0.5 rounded-full ${data.estado === 'ACTIVO' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {data.estado === 'ACTIVO' ? 'VIGENTE' : data.estado}
          </span>
          <span className="font-body text-[10px] text-gray-400">Emitido {fmtFecha(data.creado)}</span>
        </div>
        <p className="mt-1.5 font-body text-[10px] text-gray-400">{data.org.razon} · NIT {data.org.nit}</p>
      </div>
    </div>
  )
}

// ─── Cliente ────────────────────────────────────────────────────────────────

export function CarnetClient({ data }: { data: CarnetData }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [descargando, setDescargando] = useState<'png' | 'pdf' | null>(null)

  const payload = useMemo(() => {
    const doc = data.documento ? `${data.tipo_doc ?? 'CC'} ${data.documento}` : 's/d'
    return [
      'CONSERJES INMOBILIARIOS — Carnet digital',
      `Nombre: ${data.nombre}`,
      `Documento: ${doc}`,
      `Rol: ${data.rol}`,
      data.cargo ? `Cargo: ${data.cargo}` : '',
      data.empresa ? `Empresa: ${data.empresa}` : '',
      data.sede ? `Sede: ${data.sede}` : '',
      `Estado: ${data.estado}`,
      `ID: ${data.id}`,
    ].filter(Boolean).join('\n')
  }, [data])

  useEffect(() => {
    QRCode.toDataURL(payload, { width: 512, margin: 1, color: { dark: VERDE_OSCURO, light: '#ffffff' } })
      .then(setQrUrl)
      .catch(() => setQrUrl(null))
  }, [payload])

  // Cierra el modo presentación con Escape.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  /** Compone el carnet en un canvas de alta resolución (para PNG/PDF). */
  async function renderCanvas(): Promise<HTMLCanvasElement> {
    const W = 360
    const docTxt = data.documento ? `${data.tipo_doc ?? 'CC'} ${data.documento}` : null
    const rows = [
      docTxt && { label: 'DOCUMENTO', value: docTxt },
      data.cargo && { label: 'CARGO', value: data.cargo },
      data.empresa && { label: 'EMPRESA USUARIA', value: data.empresa },
      data.sede && { label: 'SEDE', value: data.sede },
      data.telefono && { label: 'TELÉFONO', value: data.telefono },
    ].filter(Boolean) as { label: string; value: string }[]

    const rowsTop = 250
    const rowH = 34
    const qrTop = rowsTop + rows.length * rowH + 16
    const qrSize = 128
    const H = qrTop + qrSize + 74

    const scale = 3
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.textBaseline = 'alphabetic'

    // Fondo transparente + tarjeta blanca
    roundRect(ctx, 0, 0, W, H, 24)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    // Header con gradiente (esquinas superiores redondeadas)
    ctx.save()
    roundRect(ctx, 0, 0, W, 112, 24)
    ctx.clip()
    ctx.beginPath(); ctx.rect(0, 24, W, 112 - 24); ctx.clip() // recorta la parte inferior recta
    const grad = ctx.createLinearGradient(0, 0, W, 112)
    grad.addColorStop(0, VERDE_OSCURO); grad.addColorStop(1, VERDE)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, 112)
    ctx.restore()
    // Repinta el header completo respetando solo las esquinas superiores
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, 24); ctx.arcTo(0, 0, 24, 0, 24); ctx.lineTo(W - 24, 0); ctx.arcTo(W, 0, W, 24, 24)
    ctx.lineTo(W, 112); ctx.lineTo(0, 112); ctx.closePath(); ctx.clip()
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 112)
    ctx.restore()

    // Logo + etiqueta
    const [logo, avatarSrc] = await Promise.all([
      loadImg('/logo-blanco.png'),
      data.avatar_url ? fetchDataUrl(data.avatar_url).then((d) => (d ? loadImg(d) : null)) : Promise.resolve(null),
    ])
    if (logo) {
      const lh = 28, lw = (logo.width / logo.height) * lh
      ctx.drawImage(logo, 20, 18, lw, lh)
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '600 10px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('CARNET', W - 20, 30)

    // Avatar (cuadrado redondeado con borde blanco, centrado sobre el header)
    const av = 96, avx = W / 2 - av / 2, avy = 112 - av / 2
    ctx.save()
    roundRect(ctx, avx - 4, avy - 4, av + 8, av + 8, 20)
    ctx.fillStyle = '#ffffff'; ctx.fill()
    ctx.restore()
    ctx.save()
    roundRect(ctx, avx, avy, av, av, 16)
    ctx.clip()
    if (avatarSrc) {
      // cubrir manteniendo proporción
      const ar = avatarSrc.width / avatarSrc.height
      let dw = av, dh = av, dx = avx, dy = avy
      if (ar > 1) { dh = av; dw = av * ar; dx = avx - (dw - av) / 2 } else { dw = av; dh = av / ar; dy = avy - (dh - av) / 2 }
      ctx.drawImage(avatarSrc, dx, dy, dw, dh)
    } else {
      ctx.fillStyle = VERDE; ctx.fillRect(avx, avy, av, av)
      ctx.fillStyle = '#ffffff'; ctx.font = '700 34px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(iniciales(data.nombre), W / 2, avy + av / 2 + 12)
    }
    ctx.restore()

    // Nombre
    ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.font = '700 20px sans-serif'
    ctx.fillText(data.nombre, W / 2, 190)

    // Pill de rol
    ctx.font = '600 12px sans-serif'
    const rolW = ctx.measureText(data.rol).width
    const pillW = rolW + 28, pillH = 24, pillX = W / 2 - pillW / 2, pillY = 202
    roundRect(ctx, pillX, pillY, pillW, pillH, 12)
    ctx.fillStyle = '#E8F5E9'; ctx.fill()
    ctx.fillStyle = VERDE; ctx.fillText(data.rol, W / 2, pillY + 16)

    // Filas de datos
    ctx.textAlign = 'left'
    rows.forEach((r, i) => {
      const y = rowsTop + i * rowH
      ctx.strokeStyle = '#F3F4F6'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(28, y + rowH - 6); ctx.lineTo(W - 28, y + rowH - 6); ctx.stroke()
      ctx.fillStyle = '#9CA3AF'; ctx.font = '600 9px sans-serif'
      ctx.fillText(r.label, 28, y + 8)
      ctx.fillStyle = '#1F2937'; ctx.font = '500 13px sans-serif'
      const val = r.value.length > 34 ? r.value.slice(0, 33) + '…' : r.value
      ctx.fillText(val, 28, y + 24)
    })

    // QR
    if (qrUrl) {
      const qr = await loadImg(qrUrl)
      if (qr) {
        ctx.save()
        roundRect(ctx, W / 2 - qrSize / 2 - 6, qrTop - 6, qrSize + 12, qrSize + 12, 12)
        ctx.fillStyle = '#ffffff'; ctx.fill()
        ctx.strokeStyle = '#F3F4F6'; ctx.stroke()
        ctx.restore()
        ctx.drawImage(qr, W / 2 - qrSize / 2, qrTop, qrSize, qrSize)
      }
    }
    ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'center'; ctx.font = '400 10px sans-serif'
    ctx.fillText('Escanea para verificar identidad', W / 2, qrTop + qrSize + 18)

    // Footer
    const fy = qrTop + qrSize + 40
    ctx.strokeStyle = '#F3F4F6'; ctx.beginPath(); ctx.moveTo(20, fy); ctx.lineTo(W - 20, fy); ctx.stroke()
    const vigente = data.estado === 'ACTIVO'
    const chip = vigente ? 'VIGENTE' : data.estado
    ctx.font = '700 9px sans-serif'
    const chipW = ctx.measureText(chip).width + 16
    roundRect(ctx, 20, fy + 8, chipW, 16, 8)
    ctx.fillStyle = vigente ? '#DCFCE7' : '#FEF3C7'; ctx.fill()
    ctx.fillStyle = vigente ? '#15803D' : '#B45309'; ctx.textAlign = 'left'
    ctx.fillText(chip, 28, fy + 19)
    ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'right'; ctx.font = '400 9px sans-serif'
    ctx.fillText(`Emitido ${fmtFecha(data.creado)}`, W - 20, fy + 19)
    ctx.textAlign = 'center'
    ctx.fillText(`${data.org.razon} · NIT ${data.org.nit}`, W / 2, fy + 36)

    return canvas
  }

  const slug = data.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  async function descargarPng() {
    setDescargando('png')
    try {
      const canvas = await renderCanvas()
      descargar(canvas.toDataURL('image/png'), `carnet-${slug || 'usuario'}.png`)
    } finally { setDescargando(null) }
  }

  async function descargarPdf() {
    setDescargando('pdf')
    try {
      const canvas = await renderCanvas()
      const wmm = 85, hmm = (canvas.height / canvas.width) * wmm
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [wmm, hmm] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, wmm, hmm)
      pdf.save(`carnet-${slug || 'usuario'}.pdf`)
    } finally { setDescargando(null) }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr] items-start">
        <CarnetCard data={data} qrUrl={qrUrl} />

        {/* Acciones */}
        <div className="space-y-3">
          <Link href="/configuracion" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
            <ArrowLeft className="w-4 h-4" /> Volver a Configuración
          </Link>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
            <p className="font-heading font-semibold text-gray-900">Comparte tu carnet</p>
            <p className="font-body text-sm text-gray-500">
              Preséntalo a pantalla completa desde el celular, o descárgalo como imagen o PDF para guardarlo.
            </p>

            <button onClick={() => setFullscreen(true)}
              className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors">
              <Maximize2 className="w-4 h-4" /> Presentar a pantalla completa
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={descargarPng} disabled={descargando !== null}
                className="flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60">
                {descargando === 'png' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Imagen
              </button>
              <button onClick={descargarPdf} disabled={descargando !== null}
                className="flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60">
                {descargando === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
              </button>
            </div>
          </div>

          {!data.documento && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="font-body text-sm text-amber-800">
                Tu cuenta aún no está vinculada a una ficha de colaborador, por eso el carnet no muestra documento ni cargo.
                Pídele a administración que te vincule desde <span className="font-semibold">Gestión Humana → Personas</span>.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modo presentación */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6"
          style={{ background: `linear-gradient(160deg, ${VERDE_OSCURO}, #0f2f14)` }}
          onClick={() => setFullscreen(false)}
        >
          <button onClick={() => setFullscreen(false)}
            className="absolute top-5 right-5 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[360px]">
            <CarnetCard data={data} qrUrl={qrUrl} />
          </div>
          <p className="mt-5 font-body text-sm text-white/70">Toca fuera del carnet para salir</p>
        </div>
      )}
    </>
  )
}
