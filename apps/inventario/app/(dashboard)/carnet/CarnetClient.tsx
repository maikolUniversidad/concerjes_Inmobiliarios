'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import {
  ArrowLeft, Maximize2, Download, FileText, Loader2, ShieldCheck,
  IdCard, Phone, Briefcase, Building2, MapPin, X, QrCode as QrIcon,
  RotateCw, HeartPulse, Shield,
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
  eps: string | null
  arl: string | null
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

/** Fecha y hora actual legible (para la marca de agua viva). */
function ahora() {
  return new Date().toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

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

// ─── Marca de agua viva (se mueve con la fecha/hora) ────────────────────────────

const WM_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899']

function Watermark() {
  const [reloj, setReloj] = useState(ahora())
  const [pos, setPos] = useState({ top: 40, left: 25 })
  const [ci, setCi] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setReloj(ahora()), 1000)
    const m = setInterval(() => {
      setPos({ top: 8 + Math.random() * 72, left: 4 + Math.random() * 46 })
    }, 2000)
    const c = setInterval(() => setCi((i) => (i + 1) % WM_COLORS.length), 300)
    return () => { clearInterval(t); clearInterval(m); clearInterval(c) }
  }, [])

  // z-40: por encima de las caras y del botón de girar. pointer-events-none
  // deja pasar los toques al carnet.
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-3xl">
      <style>{`@keyframes carnetBlink{0%,44%{opacity:1}56%,100%{opacity:.12}}`}</style>
      <div
        className="absolute whitespace-nowrap font-heading font-extrabold uppercase tracking-wider transition-[top,left] duration-1000 ease-in-out select-none"
        style={{
          top: `${pos.top}%`,
          left: `${pos.left}%`,
          transform: 'rotate(-16deg)',
          color: WM_COLORS[ci],
          fontSize: '15px',
          textShadow: '0 0 3px rgba(0,0,0,.6), 0 0 7px rgba(255,255,255,.6)',
          animation: 'carnetBlink .7s steps(1,end) infinite',
        }}
      >
        Conserjes · {reloj}
      </div>
    </div>
  )
}

// ─── Fila de datos ──────────────────────────────────────────────────────────────

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

// ─── Cara frontal ───────────────────────────────────────────────────────────────

function CarnetFrente({ data, qrUrl }: { data: CarnetData; qrUrl: string | null }) {
  const docTxt = data.documento ? `${data.tipo_doc ?? 'CC'} ${data.documento}` : null
  const rows = [
    docTxt && { icon: <IdCard className="w-4 h-4" />, label: 'Documento', value: docTxt },
    data.cargo && { icon: <Briefcase className="w-4 h-4" />, label: 'Cargo', value: data.cargo },
    data.empresa && { icon: <Building2 className="w-4 h-4" />, label: 'Empresa usuaria', value: data.empresa },
    data.sede && { icon: <MapPin className="w-4 h-4" />, label: 'Sede', value: data.sede },
    data.telefono && { icon: <Phone className="w-4 h-4" />, label: 'Teléfono', value: data.telefono },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[]

  return (
    <div className="h-full w-full rounded-3xl overflow-hidden bg-white border border-gray-200 shadow-xl">
      <div className="relative h-28" style={{ background: `linear-gradient(135deg, ${VERDE_OSCURO}, ${VERDE})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-blanco.png" alt="Conserjes Inmobiliarios" className="absolute left-4 top-4 h-7 w-auto object-contain" />
        <span className="absolute right-4 top-4 font-body text-[10px] font-semibold uppercase tracking-widest text-white/80">Carnet</span>
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

        <div className="mt-4 flex flex-col items-center gap-1.5">
          <div className="rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
            {qrUrl
              ? <img src={qrUrl} alt="QR de verificación" className="h-28 w-28" />
              : <div className="h-28 w-28 flex items-center justify-center text-gray-300"><QrIcon className="w-8 h-8" /></div>}
          </div>
          <p className="font-body text-[10px] text-gray-400">Escanea para verificar identidad</p>
        </div>

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

// ─── Cara trasera (reverso): nombre, EPS, ARL ──────────────────────────────────

function CarnetReverso({ data, qrUrl }: { data: CarnetData; qrUrl: string | null }) {
  const docTxt = data.documento ? `${data.tipo_doc ?? 'CC'} ${data.documento}` : '—'
  return (
    <div className="h-full w-full rounded-3xl overflow-hidden bg-white border border-gray-200 shadow-xl flex flex-col">
      <div className="relative h-16 shrink-0" style={{ background: `linear-gradient(135deg, ${VERDE_OSCURO}, ${VERDE})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-blanco.png" alt="Conserjes Inmobiliarios" className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-auto object-contain" />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-body text-[10px] font-semibold uppercase tracking-widest text-white/80">Reverso</span>
      </div>

      <div className="flex-1 px-5 py-4 flex flex-col">
        <div className="text-center">
          <p className="font-body text-[10px] uppercase tracking-wide text-gray-400">Titular</p>
          <h2 className="font-heading font-bold text-lg text-gray-900 leading-tight">{data.nombre}</h2>
          <p className="font-body text-xs text-gray-500 mt-0.5">{docTxt}</p>
        </div>

        <div className="mt-4 space-y-2">
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 px-3">
            <InfoRow icon={<HeartPulse className="w-4 h-4" />} label="EPS" value={data.eps || 'No registrada'} />
            <InfoRow icon={<Shield className="w-4 h-4" />} label="ARL" value={data.arl || 'No registrada'} />
            {data.grupo && <InfoRow icon={<Building2 className="w-4 h-4" />} label="Grupo / Contrato" value={data.grupo} />}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="rounded-lg border border-gray-100 bg-white p-1.5 shadow-sm shrink-0">
            {qrUrl
              ? <img src={qrUrl} alt="QR" className="h-16 w-16" />
              : <div className="h-16 w-16 flex items-center justify-center text-gray-300"><QrIcon className="w-6 h-6" /></div>}
          </div>
          <p className="font-body text-[11px] leading-snug text-gray-500">
            Carnet personal e intransferible. En caso de pérdida, repórtelo a administración.
          </p>
        </div>

        <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
          <span className={`font-body text-[10px] font-semibold px-2 py-0.5 rounded-full ${data.estado === 'ACTIVO' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {data.estado === 'ACTIVO' ? 'VIGENTE' : data.estado}
          </span>
          <span className="font-body text-[10px] text-gray-400">{data.org.razon} · NIT {data.org.nit}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Carnet con giro (dos caras) + marca de agua ───────────────────────────────

function CarnetFlip({ data, qrUrl }: { data: CarnetData; qrUrl: string | null }) {
  const [flip, setFlip] = useState(false)
  return (
    <div className="relative w-full max-w-[360px] mx-auto">
      <div className="[perspective:1600px] cursor-pointer" onClick={() => setFlip((v) => !v)}>
        <div
          className="relative transition-transform duration-700 [transform-style:preserve-3d]"
          style={{ transform: flip ? 'rotateY(180deg)' : 'none', minHeight: 520 }}
        >
          {/* Frente */}
          <div className="[backface-visibility:hidden]">
            <CarnetFrente data={data} qrUrl={qrUrl} />
          </div>
          {/* Reverso */}
          <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <CarnetReverso data={data} qrUrl={qrUrl} />
          </div>
        </div>
      </div>

      {/* Marca de agua viva encima de ambas caras */}
      <Watermark />

      {/* Botón girar */}
      <button
        onClick={(e) => { e.stopPropagation(); setFlip((v) => !v) }}
        className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-1.5 rounded-full bg-white border border-gray-200 shadow-md px-3 py-1.5 font-body text-xs font-semibold text-brand-green hover:bg-green-50 transition-colors"
      >
        <RotateCw className="w-3.5 h-3.5" /> {flip ? 'Ver frente' : 'Ver reverso'}
      </button>
    </div>
  )
}

// ─── Cliente ────────────────────────────────────────────────────────────────

export function CarnetClient({ data }: { data: CarnetData }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [descargando, setDescargando] = useState<'png' | 'pdf' | null>(null)
  const [caraDescarga, setCaraDescarga] = useState<'frente' | 'reverso'>('frente')

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
      data.eps ? `EPS: ${data.eps}` : '',
      data.arl ? `ARL: ${data.arl}` : '',
      `Estado: ${data.estado}`,
      `ID: ${data.id}`,
    ].filter(Boolean).join('\n')
  }, [data])

  useEffect(() => {
    QRCode.toDataURL(payload, { width: 512, margin: 1, color: { dark: VERDE_OSCURO, light: '#ffffff' } })
      .then(setQrUrl)
      .catch(() => setQrUrl(null))
  }, [payload])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  /** Marca de agua diagonal repetida con la fecha/hora de generación. */
  function drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const text = `CONSERJES · ${ahora()}`
    ctx.save()
    ctx.globalAlpha = 0.07
    ctx.fillStyle = VERDE_OSCURO
    ctx.font = '700 10px sans-serif'
    ctx.textAlign = 'left'
    ctx.translate(W / 2, H / 2)
    ctx.rotate(-Math.PI / 9)
    for (let y = -H; y < H; y += 26) {
      for (let x = -W; x < W; x += 150) ctx.fillText(text, x, y)
    }
    ctx.restore()
  }

  /** Compone una cara del carnet en un canvas de alta resolución. */
  async function renderCanvas(cara: 'frente' | 'reverso'): Promise<HTMLCanvasElement> {
    const W = 360
    const docTxt = data.documento ? `${data.tipo_doc ?? 'CC'} ${data.documento}` : '—'

    const scale = 3
    const make = (H: number) => {
      const c = document.createElement('canvas')
      c.width = W * scale; c.height = H * scale
      const ctx = c.getContext('2d')!
      ctx.scale(scale, scale)
      return { c, ctx }
    }

    const logo = await loadImg('/logo-blanco.png')

    const headerTop = (ctx: CanvasRenderingContext2D, W2: number, hH: number, etiqueta: string) => {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(0, 24); ctx.arcTo(0, 0, 24, 0, 24); ctx.lineTo(W2 - 24, 0); ctx.arcTo(W2, 0, W2, 24, 24)
      ctx.lineTo(W2, hH); ctx.lineTo(0, hH); ctx.closePath(); ctx.clip()
      const grad = ctx.createLinearGradient(0, 0, W2, hH)
      grad.addColorStop(0, VERDE_OSCURO); grad.addColorStop(1, VERDE)
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W2, hH)
      ctx.restore()
      if (logo) {
        const lh = 26, lw = (logo.width / logo.height) * lh
        ctx.drawImage(logo, 20, hH / 2 - lh / 2, lw, lh)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 10px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(etiqueta, W2 - 20, hH / 2 + 3)
    }

    if (cara === 'frente') {
      const rows = [
        data.documento && { label: 'DOCUMENTO', value: docTxt },
        data.cargo && { label: 'CARGO', value: data.cargo },
        data.empresa && { label: 'EMPRESA USUARIA', value: data.empresa },
        data.sede && { label: 'SEDE', value: data.sede },
        data.telefono && { label: 'TELÉFONO', value: data.telefono },
      ].filter(Boolean) as { label: string; value: string }[]
      const rowsTop = 250, rowH = 34
      const qrTop = rowsTop + rows.length * rowH + 16, qrSize = 128
      const H = qrTop + qrSize + 74
      const { c, ctx } = make(H)

      roundRect(ctx, 0, 0, W, H, 24); ctx.fillStyle = '#ffffff'; ctx.fill()
      headerTop(ctx, W, 112, 'CARNET')

      const avatarSrc = data.avatar_url ? await fetchDataUrl(data.avatar_url).then((d) => (d ? loadImg(d) : null)) : null
      const av = 96, avx = W / 2 - av / 2, avy = 112 - av / 2
      roundRect(ctx, avx - 4, avy - 4, av + 8, av + 8, 20); ctx.fillStyle = '#ffffff'; ctx.fill()
      ctx.save(); roundRect(ctx, avx, avy, av, av, 16); ctx.clip()
      if (avatarSrc) {
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

      ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.font = '700 20px sans-serif'
      ctx.fillText(data.nombre, W / 2, 190)
      ctx.font = '600 12px sans-serif'
      const rolW = ctx.measureText(data.rol).width
      const pillW = rolW + 28, pillX = W / 2 - pillW / 2, pillY = 202
      roundRect(ctx, pillX, pillY, pillW, 24, 12); ctx.fillStyle = '#E8F5E9'; ctx.fill()
      ctx.fillStyle = VERDE; ctx.fillText(data.rol, W / 2, pillY + 16)

      ctx.textAlign = 'left'
      rows.forEach((r, i) => {
        const y = rowsTop + i * rowH
        ctx.strokeStyle = '#F3F4F6'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(28, y + rowH - 6); ctx.lineTo(W - 28, y + rowH - 6); ctx.stroke()
        ctx.fillStyle = '#9CA3AF'; ctx.font = '600 9px sans-serif'; ctx.fillText(r.label, 28, y + 8)
        ctx.fillStyle = '#1F2937'; ctx.font = '500 13px sans-serif'
        ctx.fillText(r.value.length > 34 ? r.value.slice(0, 33) + '…' : r.value, 28, y + 24)
      })

      if (qrUrl) {
        const qr = await loadImg(qrUrl)
        if (qr) {
          roundRect(ctx, W / 2 - qrSize / 2 - 6, qrTop - 6, qrSize + 12, qrSize + 12, 12)
          ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#F3F4F6'; ctx.stroke()
          ctx.drawImage(qr, W / 2 - qrSize / 2, qrTop, qrSize, qrSize)
        }
      }
      ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'center'; ctx.font = '400 10px sans-serif'
      ctx.fillText('Escanea para verificar identidad', W / 2, qrTop + qrSize + 18)
      const fy = qrTop + qrSize + 40
      ctx.strokeStyle = '#F3F4F6'; ctx.beginPath(); ctx.moveTo(20, fy); ctx.lineTo(W - 20, fy); ctx.stroke()
      const vig = data.estado === 'ACTIVO'
      const chip = vig ? 'VIGENTE' : data.estado
      ctx.font = '700 9px sans-serif'; const chipW = ctx.measureText(chip).width + 16
      roundRect(ctx, 20, fy + 8, chipW, 16, 8); ctx.fillStyle = vig ? '#DCFCE7' : '#FEF3C7'; ctx.fill()
      ctx.fillStyle = vig ? '#15803D' : '#B45309'; ctx.textAlign = 'left'; ctx.fillText(chip, 28, fy + 19)
      ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'right'; ctx.font = '400 9px sans-serif'
      ctx.fillText(`Emitido ${fmtFecha(data.creado)}`, W - 20, fy + 19)
      ctx.textAlign = 'center'; ctx.fillText(`${data.org.razon} · NIT ${data.org.nit}`, W / 2, fy + 36)

      drawWatermark(ctx, W, H)
      return c
    }

    // ── Reverso ──
    const H = 520
    const { c, ctx } = make(H)
    roundRect(ctx, 0, 0, W, H, 24); ctx.fillStyle = '#ffffff'; ctx.fill()
    headerTop(ctx, W, 64, 'REVERSO')

    ctx.textAlign = 'center'
    ctx.fillStyle = '#9CA3AF'; ctx.font = '600 9px sans-serif'; ctx.fillText('TITULAR', W / 2, 96)
    ctx.fillStyle = '#111827'; ctx.font = '700 19px sans-serif'; ctx.fillText(data.nombre, W / 2, 118)
    ctx.fillStyle = '#6B7280'; ctx.font = '400 12px sans-serif'; ctx.fillText(docTxt, W / 2, 136)

    const campos = [
      { label: 'EPS', value: data.eps || 'No registrada' },
      { label: 'ARL', value: data.arl || 'No registrada' },
      ...(data.grupo ? [{ label: 'GRUPO / CONTRATO', value: data.grupo }] : []),
    ]
    ctx.textAlign = 'left'
    campos.forEach((r, i) => {
      const y = 170 + i * 40
      roundRect(ctx, 24, y, W - 48, 34, 10); ctx.fillStyle = '#F9FAFB'; ctx.fill()
      ctx.fillStyle = '#9CA3AF'; ctx.font = '600 9px sans-serif'; ctx.fillText(r.label, 36, y + 14)
      ctx.fillStyle = '#1F2937'; ctx.font = '600 13px sans-serif'
      ctx.fillText(r.value.length > 36 ? r.value.slice(0, 35) + '…' : r.value, 36, y + 28)
    })

    if (qrUrl) {
      const qr = await loadImg(qrUrl)
      if (qr) {
        const qs = 72, qy = 170 + campos.length * 40 + 12
        roundRect(ctx, 24, qy, qs, qs, 8); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#F3F4F6'; ctx.stroke()
        ctx.drawImage(qr, 24, qy, qs, qs)
        ctx.fillStyle = '#6B7280'; ctx.font = '400 10px sans-serif'; ctx.textAlign = 'left'
        const tx = 24 + qs + 12
        ctx.fillText('Carnet personal e intransferible.', tx, qy + 22)
        ctx.fillText('En caso de pérdida repórtelo a', tx, qy + 38)
        ctx.fillText('administración.', tx, qy + 54)
      }
    }

    ctx.strokeStyle = '#F3F4F6'; ctx.beginPath(); ctx.moveTo(20, H - 40); ctx.lineTo(W - 20, H - 40); ctx.stroke()
    ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'center'; ctx.font = '400 9px sans-serif'
    ctx.fillText(`${data.org.razon} · NIT ${data.org.nit}`, W / 2, H - 22)

    drawWatermark(ctx, W, H)
    return c
  }

  const slug = data.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  async function descargarPng() {
    setDescargando('png')
    try {
      const canvas = await renderCanvas(caraDescarga)
      descargar(canvas.toDataURL('image/png'), `carnet-${slug || 'usuario'}-${caraDescarga}.png`)
    } finally { setDescargando(null) }
  }

  async function descargarPdf() {
    setDescargando('pdf')
    try {
      const frente = await renderCanvas('frente')
      const reverso = await renderCanvas('reverso')
      const wmm = 85
      const hF = (frente.height / frente.width) * wmm
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [wmm, hF] })
      pdf.addImage(frente.toDataURL('image/png'), 'PNG', 0, 0, wmm, hF)
      const hR = (reverso.height / reverso.width) * wmm
      pdf.addPage([wmm, hR], 'portrait')
      pdf.addImage(reverso.toDataURL('image/png'), 'PNG', 0, 0, wmm, hR)
      pdf.save(`carnet-${slug || 'usuario'}.pdf`)
    } finally { setDescargando(null) }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr] items-start">
        <CarnetFlip data={data} qrUrl={qrUrl} />

        <div className="space-y-3">
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
            <ArrowLeft className="w-4 h-4" /> Volver al inicio
          </Link>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
            <p className="font-heading font-semibold text-gray-900">Comparte tu carnet</p>
            <p className="font-body text-sm text-gray-500">
              Tiene dos caras (frente y reverso con EPS/ARL). Preséntalo a pantalla completa desde el celular,
              o descárgalo. La marca de agua con la fecha y hora se mueve sobre el carnet en vivo.
            </p>

            <button onClick={() => setFullscreen(true)}
              className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors">
              <Maximize2 className="w-4 h-4" /> Presentar a pantalla completa
            </button>

            {/* Selección de cara para la imagen */}
            <div className="flex items-center gap-2">
              <span className="font-body text-xs text-gray-500">Imagen:</span>
              {(['frente', 'reverso'] as const).map((cara) => (
                <button key={cara} onClick={() => setCaraDescarga(cara)}
                  className={`font-body text-xs font-semibold px-3 py-1 rounded-full border transition-colors capitalize ${
                    caraDescarga === cara ? 'bg-green-50 text-brand-green border-brand-green' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {cara}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={descargarPng} disabled={descargando !== null}
                className="flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60">
                {descargando === 'png' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Imagen
              </button>
              <button onClick={descargarPdf} disabled={descargando !== null}
                className="flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60">
                {descargando === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF (2 caras)
              </button>
            </div>
          </div>

          {!data.documento && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="font-body text-sm text-amber-800">
                Tu cuenta aún no está vinculada a una ficha de colaborador, por eso el carnet no muestra documento, EPS ni ARL.
                Pídele a administración que te vincule desde <span className="font-semibold">Gestión Humana → Personas</span>.
              </p>
            </div>
          )}
        </div>
      </div>

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
            <CarnetFlip data={data} qrUrl={qrUrl} />
          </div>
          <p className="mt-8 font-body text-sm text-white/70">Toca el carnet para girarlo · toca fuera para salir</p>
        </div>
      )}
    </>
  )
}
