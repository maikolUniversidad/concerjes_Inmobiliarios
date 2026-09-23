'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Camera, Loader2, ImageUp, Zap, ZapOff, RotateCw, Check, Plus, Trash2, ChevronLeft, ChevronRight, ScanLine, Maximize, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  detectarHoja, enderezar, mejorarDocumento, tamanoSalida, esquinasPorDefecto, escalarEsquinas, ordenarEsquinas,
  type Esquinas, type Imagen, type ModoMejora, type Punto,
} from '@/lib/escaner/procesamiento'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Pagina { id: string; original: Blob; procesada: Blob; url: string; modo: ModoMejora; ancho: number; alto: number }
interface Foto { canvas: HTMLCanvasElement; url: string; esquinas: Esquinas; detectada: boolean }
type Fase = 'camara' | 'ajustar' | 'paginas' | 'guardando'

const MODOS: { key: ModoMejora; label: string }[] = [
  { key: 'color', label: 'Documento' }, { key: 'bn', label: 'Blanco y negro' },
  { key: 'grises', label: 'Grises' }, { key: 'original', label: 'Original' },
]
const MAX_FOTO = 2600     // lado máximo de la foto que se procesa
const MAX_PAGINA = 2000   // lado máximo de la página enderezada (~180 ppp en carta)
const AUTO_ESTABLE = 6    // detecciones seguidas sin moverse para la captura automática

// ── Utilidades de canvas ─────────────────────────────────────────────────────
function aCanvas(img: Imagen): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  c.getContext('2d')!.putImageData(new ImageData(img.data as any, img.width, img.height), 0, 0)
  return c
}
function aBlob(c: HTMLCanvasElement, calidad: number): Promise<Blob> {
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo guardar la imagen.'))), 'image/jpeg', calidad))
}
function leer(c: HTMLCanvasElement): Imagen {
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height) as unknown as Imagen
}
async function imagenDeBlob(b: Blob): Promise<Imagen> {
  const bmp = await createImageBitmap(b)
  const c = document.createElement('canvas')
  c.width = bmp.width; c.height = bmp.height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return leer(c)
}
/** Abre una imagen elegida del equipo respetando la orientación de la foto (con respaldo para Safari). */
async function decodificar(file: File): Promise<{ fuente: CanvasImageSource; w: number; h: number; liberar: () => void }> {
  for (const op of [{ imageOrientation: 'from-image' } as ImageBitmapOptions, undefined]) {
    try {
      const b = await createImageBitmap(file, op)
      return { fuente: b, w: b.width, h: b.height, liberar: () => b.close() }
    } catch { /* siguiente intento */ }
  }
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((ok, mal) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => mal(new Error('No se pudo leer la imagen.'))
    i.src = url
  })
  return { fuente: img, w: img.naturalWidth, h: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) }
}

/** Detecta la hoja sobre una copia pequeña (rápido) y devuelve las esquinas en la escala real. */
function detectarEn(fuente: CanvasImageSource, w: number, h: number, ancho = 400): Esquinas | null {
  const esc = Math.min(1, ancho / w)
  const c = document.createElement('canvas')
  c.width = Math.round(w * esc); c.height = Math.round(h * esc)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(fuente, 0, 0, c.width, c.height)
  const q = detectarHoja(ctx.getImageData(0, 0, c.width, c.height) as unknown as Imagen)
  return q ? escalarEsquinas(q, 1 / esc) : null
}
const quieta = (a: Esquinas, b: Esquinas, w: number, h: number) =>
  a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < Math.hypot(w, h) * 0.018)

/**
 * Escáner de documentos con la cámara del celular: detecta la hoja en vivo (y
 * la captura sola cuando está quieta), deja ajustar las esquinas, endereza la
 * perspectiva y la deja con aspecto de escaneado. Varias páginas → un PDF (o
 * una imagen por página).
 */
export function EscanerDocumento({
  titulo, subtitulo, salida = 'pdf', nombreArchivo = 'documento-escaneado', maxPaginas = 30, onListo, onCerrar,
}: {
  titulo: string
  subtitulo?: string
  salida?: 'pdf' | 'imagenes'
  nombreArchivo?: string
  maxPaginas?: number
  onListo: (archivos: File[]) => void | Promise<void>
  onCerrar: () => void
}) {
  const [fase, setFase] = useState<Fase>('camara')
  const [camara, setCamara] = useState<'iniciando' | 'lista' | 'error'>('iniciando')
  const [guia, setGuia] = useState<Esquinas | null>(null)
  const [estables, setEstables] = useState(0)
  const [auto, setAuto] = useState(true)
  const [linterna, setLinterna] = useState<boolean | null>(null)   // null = no disponible
  const [capturando, setCapturando] = useState(false)
  const [foto, setFoto] = useState<Foto | null>(null)
  const [paginas, setPaginas] = useState<Pagina[]>([])
  const [sel, setSel] = useState(0)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [modoDefecto, setModoDefecto] = useState<ModoMejora>('color')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const capturandoRef = useRef(false)
  const autoRef = useRef(auto)
  autoRef.current = auto
  const galeriaRef = useRef<HTMLInputElement>(null)
  const nativaRef = useRef<HTMLInputElement>(null)

  // ── Cámara ─────────────────────────────────────────────────────────────────
  const apagar = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (fase !== 'camara') return
    let vivo = true
    ;(async () => {
      try {
        if (!streamRef.current) {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara')
          const s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
          })
          if (!vivo) { s.getTracks().forEach((t) => t.stop()); return }
          streamRef.current = s
          const track = s.getVideoTracks()[0]
          const cap = (track.getCapabilities?.() ?? {}) as any
          setLinterna(cap.torch ? false : null)
          try { if (cap.focusMode?.includes?.('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }) } catch { /* sin enfoque continuo */ }
        }
        const v = videoRef.current
        if (v && v.srcObject !== streamRef.current) {
          v.srcObject = streamRef.current
          await v.play().catch(() => {})
        }
        if (vivo) setCamara('lista')
      } catch {
        if (vivo) setCamara('error')
      }
    })()
    return () => { vivo = false }
  }, [fase])

  useEffect(() => () => apagar(), [apagar])

  async function alternarLinterna() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || linterna === null) return
    try { await track.applyConstraints({ advanced: [{ torch: !linterna } as any] }); setLinterna(!linterna) } catch { setLinterna(null) }
  }

  // ── Foto → ajustar esquinas ─────────────────────────────────────────────────
  const prepararFoto = useCallback(async (fuente: CanvasImageSource, w: number, h: number) => {
    const f = Math.min(1, MAX_FOTO / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * f); canvas.height = Math.round(h * f)
    canvas.getContext('2d')!.drawImage(fuente, 0, 0, canvas.width, canvas.height)
    const q = detectarEn(canvas, canvas.width, canvas.height, 480)
    const url = URL.createObjectURL(await aBlob(canvas, 0.85))
    setFoto({ canvas, url, esquinas: q ?? esquinasPorDefecto(canvas.width, canvas.height), detectada: !!q })
    setFase('ajustar')
  }, [])

  const capturar = useCallback(async () => {
    if (capturandoRef.current) return
    const v = videoRef.current
    if (!v?.videoWidth) return
    capturandoRef.current = true
    setCapturando(true)
    try {
      const track = streamRef.current?.getVideoTracks()[0]
      let bmp: ImageBitmap | null = null
      // Foto con la resolución completa del sensor cuando el navegador lo permite.
      if (track && typeof (window as any).ImageCapture === 'function') {
        try { bmp = await createImageBitmap(await new (window as any).ImageCapture(track).takePhoto()) } catch { bmp = null }
      }
      if (bmp) { await prepararFoto(bmp, bmp.width, bmp.height); bmp.close() }
      else await prepararFoto(v, v.videoWidth, v.videoHeight)
    } catch {
      toast.error('No se pudo tomar la foto. Intenta de nuevo.')
    } finally {
      capturandoRef.current = false
      setCapturando(false)
    }
  }, [prepararFoto])

  // Detección en vivo: dibuja la hoja encontrada y dispara la captura automática.
  useEffect(() => {
    if (fase !== 'camara' || camara !== 'lista') return
    let previo: Esquinas | null = null
    let cuenta = 0
    const t = setInterval(() => {
      const v = videoRef.current
      if (!v?.videoWidth || capturandoRef.current) return
      const q = detectarEn(v, v.videoWidth, v.videoHeight, 360)
      setGuia(q)
      cuenta = q && previo && quieta(q, previo, v.videoWidth, v.videoHeight) ? cuenta + 1 : 0
      previo = q
      setEstables(cuenta)
      if (autoRef.current && cuenta >= AUTO_ESTABLE) { cuenta = 0; void capturar() }
    }, 180)
    return () => clearInterval(t)
  }, [fase, camara, capturar])

  async function desdeArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const img = await decodificar(file)
      await prepararFoto(img.fuente, img.w, img.h)
      img.liberar()
    } catch {
      toast.error('No se pudo leer esa imagen. Usa una foto JPG o PNG.')
    }
  }

  // ── Ajustar esquinas (arrastrar los puntos) ─────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null)
  const arrastre = useRef<number | null>(null)
  const [escalaVista, setEscalaVista] = useState(1)
  useEffect(() => {
    if (fase !== 'ajustar' || !foto || !svgRef.current) return
    const medir = () => {
      const r = svgRef.current?.getBoundingClientRect()
      if (r) setEscalaVista(Math.min(r.width / foto.canvas.width, r.height / foto.canvas.height) || 1)
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(svgRef.current)
    return () => ro.disconnect()
  }, [fase, foto])

  function puntoSvg(e: React.PointerEvent): Punto | null {
    const svg = svgRef.current
    if (!svg || !foto) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: Math.max(0, Math.min(foto.canvas.width, p.x)), y: Math.max(0, Math.min(foto.canvas.height, p.y)) }
  }
  function moverEsquina(e: React.PointerEvent) {
    if (arrastre.current === null || !foto) return
    const p = puntoSvg(e)
    if (!p) return
    const q = [...foto.esquinas] as Esquinas
    q[arrastre.current] = p
    setFoto({ ...foto, esquinas: q })
  }

  async function girar() {
    if (!foto) return
    const { canvas } = foto
    const c = document.createElement('canvas')
    c.width = canvas.height; c.height = canvas.width
    const ctx = c.getContext('2d')!
    ctx.translate(c.width, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(canvas, 0, 0)
    const q = ordenarEsquinas(foto.esquinas.map((p) => ({ x: canvas.height - p.y, y: p.x })))
    URL.revokeObjectURL(foto.url)
    setFoto({ canvas: c, url: URL.createObjectURL(await aBlob(c, 0.85)), esquinas: q, detectada: foto.detectada })
  }

  async function recortar() {
    if (!foto) return
    setTrabajando('Enderezando la hoja…')
    await new Promise((r) => setTimeout(r, 30))
    try {
      const { ancho, alto } = tamanoSalida(foto.esquinas, MAX_PAGINA)
      const recta = enderezar(leer(foto.canvas), foto.esquinas, ancho, alto)
      const original = await aBlob(aCanvas(recta), 0.9)
      const procesada = await aBlob(aCanvas(mejorarDocumento(recta, modoDefecto)), 0.86)
      URL.revokeObjectURL(foto.url)
      setFoto(null)
      setPaginas((ps) => {
        const n = [...ps, { id: crypto.randomUUID(), original, procesada, url: URL.createObjectURL(procesada), modo: modoDefecto, ancho, alto }]
        setSel(n.length - 1)
        return n
      })
      setFase('paginas')
    } catch {
      toast.error('No se pudo procesar la foto. Intenta de nuevo.')
    } finally {
      setTrabajando(null)
    }
  }

  // ── Páginas ─────────────────────────────────────────────────────────────────
  async function cambiarModo(modo: ModoMejora) {
    const p = paginas[sel]
    if (!p || p.modo === modo) return
    setTrabajando('Aplicando…')
    await new Promise((r) => setTimeout(r, 30))
    try {
      const procesada = await aBlob(aCanvas(mejorarDocumento(await imagenDeBlob(p.original), modo)), 0.86)
      URL.revokeObjectURL(p.url)
      setPaginas((ps) => ps.map((x, i) => (i === sel ? { ...x, procesada, url: URL.createObjectURL(procesada), modo } : x)))
      setModoDefecto(modo)
    } finally {
      setTrabajando(null)
    }
  }
  function moverPagina(paso: number) {
    const j = sel + paso
    if (j < 0 || j >= paginas.length) return
    setPaginas((ps) => { const n = [...ps]; [n[sel], n[j]] = [n[j], n[sel]]; return n })
    setSel(j)
  }
  function borrarPagina() {
    const p = paginas[sel]
    if (!p) return
    URL.revokeObjectURL(p.url)
    const n = paginas.filter((_, i) => i !== sel)
    setPaginas(n)
    setSel(Math.max(0, sel - 1))
    if (!n.length) setFase('camara')
  }
  // Al cerrar, se liberan las vistas previas de las páginas.
  const paginasRef = useRef(paginas)
  paginasRef.current = paginas
  useEffect(() => () => { paginasRef.current.forEach((p) => URL.revokeObjectURL(p.url)) }, [])

  async function guardar() {
    if (!paginas.length) return
    setFase('guardando')
    try {
      let archivos: File[]
      if (salida === 'pdf') {
        const { PDFDocument } = await import('pdf-lib')
        const pdf = await PDFDocument.create()
        for (const p of paginas) {
          const img = await pdf.embedJpg(new Uint8Array(await p.procesada.arrayBuffer()))
          const ancho = 612, alto = Math.round((612 * p.alto) / p.ancho)
          pdf.addPage([ancho, alto]).drawImage(img, { x: 0, y: 0, width: ancho, height: alto })
        }
        pdf.setTitle(titulo)
        pdf.setCreator('Conserjes Inmobiliarios · escáner')
        archivos = [new File([(await pdf.save()) as BlobPart], `${nombreArchivo}.pdf`, { type: 'application/pdf' })]
      } else {
        archivos = paginas.map((p, i) => new File([p.procesada], `${nombreArchivo}-${i + 1}.jpg`, { type: 'image/jpeg' }))
      }
      apagar()
      await onListo(archivos)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el escaneo.')
      setFase('paginas')
    }
  }

  function cerrar() {
    if (paginas.length && !window.confirm('¿Salir sin guardar las páginas escaneadas?')) return
    apagar()
    onCerrar()
  }

  const pag = paginas[sel]
  const listas = paginas.length >= maxPaginas

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={titulo}>
      {/* Encabezado */}
      <div className="flex items-center gap-2 px-3 py-2">
        <ScanLine className="h-5 w-5 shrink-0 text-green-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{titulo}</p>
          <p className="truncate text-[11px] text-white/60">
            {subtitulo ?? (fase === 'ajustar' ? 'Ajusta las esquinas a la hoja' : fase === 'paginas' || fase === 'guardando' ? `${paginas.length} página(s)` : `Página ${paginas.length + 1}`)}
          </p>
        </div>
        <button type="button" onClick={cerrar} className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar"><X className="h-6 w-6" /></button>
      </div>

      {/* ── Cámara ── */}
      {fase === 'camara' && (
        <>
          <div className="relative min-h-0 flex-1">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-contain" />
            {guia && videoRef.current?.videoWidth ? (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${videoRef.current.videoWidth} ${videoRef.current.videoHeight}`} preserveAspectRatio="xMidYMid meet">
                <polygon points={guia.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(74,222,128,0.18)" stroke="#4ade80"
                  strokeWidth={videoRef.current.videoWidth * 0.006} strokeLinejoin="round" />
              </svg>
            ) : null}
            {camara === 'iniciando' && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-white/70" /></div>}
            {camara === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-sm rounded-2xl bg-white p-5 text-center text-gray-800">
                  <Camera className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm">No pudimos abrir la cámara aquí. Da permiso a la cámara en el navegador, o usa una de estas opciones:</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <button type="button" onClick={() => nativaRef.current?.click()} className="rounded-xl bg-green-700 px-4 py-2.5 text-sm font-semibold text-white">Tomar la foto con la cámara del celular</button>
                    <button type="button" onClick={() => galeriaRef.current?.click()} className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold">Elegir una foto de la galería</button>
                  </div>
                </div>
              </div>
            )}
            {camara === 'lista' && (
              <p className="absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-full bg-black/60 px-3 py-1.5 text-center text-xs">
                {!guia ? 'Ubica la hoja completa sobre una superficie oscura y con buena luz'
                  : estables >= 2 ? (auto ? 'Hoja detectada · mantén el celular quieto…' : 'Hoja detectada · toma la foto')
                  : 'Hoja detectada'}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-5 pb-6 pt-3">
            <button type="button" onClick={() => galeriaRef.current?.click()} className="flex w-16 flex-col items-center gap-1 text-[11px] text-white/80">
              <ImageUp className="h-6 w-6" /> Galería
            </button>
            <button type="button" onClick={() => void capturar()} disabled={camara !== 'lista' || capturando || listas}
              className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40" aria-label="Tomar foto">
              <span className={'h-14 w-14 rounded-full ' + (guia ? 'bg-green-400' : 'bg-white')} />
              {capturando && <Loader2 className="absolute h-7 w-7 animate-spin text-black" />}
              {auto && guia && !capturando && (
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="33" fill="none" stroke="#16a34a" strokeWidth="4" strokeDasharray={`${(Math.min(estables, AUTO_ESTABLE) / AUTO_ESTABLE) * 207} 207`} />
                </svg>
              )}
            </button>
            <div className="flex w-16 flex-col items-center gap-2">
              <button type="button" onClick={() => setAuto((a) => !a)} className={'rounded-full px-2 py-0.5 text-[10px] font-bold ' + (auto ? 'bg-green-500 text-black' : 'bg-white/15 text-white/80')}>
                AUTO {auto ? 'SÍ' : 'NO'}
              </button>
              {linterna !== null && (
                <button type="button" onClick={alternarLinterna} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Linterna">
                  {linterna ? <Zap className="h-5 w-5 text-yellow-300" /> : <ZapOff className="h-5 w-5" />}
                </button>
              )}
              {paginas.length > 0 && (
                <button type="button" onClick={() => setFase('paginas')} className="text-[11px] font-semibold text-green-300">Listo ({paginas.length})</button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Ajustar esquinas ── */}
      {fase === 'ajustar' && foto && (
        <>
          <div className="relative min-h-0 flex-1 p-2">
            <svg ref={svgRef} className="h-full w-full touch-none select-none" viewBox={`0 0 ${foto.canvas.width} ${foto.canvas.height}`} preserveAspectRatio="xMidYMid meet"
              onPointerMove={moverEsquina} onPointerUp={() => { arrastre.current = null }} onPointerCancel={() => { arrastre.current = null }}>
              <image href={foto.url} x={0} y={0} width={foto.canvas.width} height={foto.canvas.height} />
              <polygon points={foto.esquinas.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(74,222,128,0.15)" stroke="#4ade80" strokeWidth={2 / escalaVista} strokeLinejoin="round" />
              {foto.esquinas.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={26 / escalaVista} fill="transparent"
                    onPointerDown={(e) => { arrastre.current = i; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId) }} />
                  <circle cx={p.x} cy={p.y} r={11 / escalaVista} fill="rgba(255,255,255,0.95)" stroke="#16a34a" strokeWidth={3 / escalaVista} pointerEvents="none" />
                </g>
              ))}
            </svg>
            {!foto.detectada && (
              <p className="absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-full bg-black/70 px-3 py-1.5 text-center text-xs">
                No encontramos bien la hoja: arrastra los puntos a sus esquinas
              </p>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 px-3 pb-6 pt-2 text-[11px]">
            <button type="button" onClick={() => { URL.revokeObjectURL(foto.url); setFoto(null); setFase('camara') }} className="flex flex-col items-center gap-1 rounded-xl py-2 hover:bg-white/10">
              <Camera className="h-5 w-5" /> Repetir
            </button>
            <button type="button" onClick={() => setFoto({ ...foto, esquinas: esquinasPorDefecto(foto.canvas.width, foto.canvas.height, 0) })} className="flex flex-col items-center gap-1 rounded-xl py-2 hover:bg-white/10">
              <Maximize className="h-5 w-5" /> Toda la foto
            </button>
            <button type="button" onClick={() => void girar()} className="flex flex-col items-center gap-1 rounded-xl py-2 hover:bg-white/10">
              <RotateCw className="h-5 w-5" /> Girar
            </button>
            <button type="button" onClick={() => void recortar()} className="flex flex-col items-center gap-1 rounded-xl bg-green-600 py-2 font-semibold hover:bg-green-500">
              <Check className="h-5 w-5" /> Usar
            </button>
          </div>
        </>
      )}

      {/* ── Páginas ── */}
      {(fase === 'paginas' || fase === 'guardando') && (
        <>
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-neutral-900 p-3">
            {pag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pag.url} alt={`Página ${sel + 1}`} className="max-h-full max-w-full rounded bg-white object-contain shadow-lg" />
            )}
            {fase === 'guardando' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
                <Loader2 className="h-8 w-8 animate-spin" /><p className="text-sm">Guardando…</p>
              </div>
            )}
          </div>
          <div className="space-y-2 px-3 pb-5 pt-2">
            <div className="flex gap-1.5 overflow-x-auto">
              {MODOS.map((m) => (
                <button key={m.key} type="button" onClick={() => void cambiarModo(m.key)} disabled={fase === 'guardando'}
                  className={'flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ' + (pag?.modo === m.key ? 'bg-green-500 text-black' : 'bg-white/10 text-white')}>
                  {m.key === 'color' && <Sparkles className="h-3.5 w-3.5" />}{m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {paginas.map((p, i) => (
                <button key={p.id} type="button" onClick={() => setSel(i)}
                  className={'relative h-16 w-12 shrink-0 overflow-hidden rounded border-2 bg-white ' + (i === sel ? 'border-green-400' : 'border-transparent opacity-70')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[9px]">{i + 1}</span>
                </button>
              ))}
              {!listas && (
                <button type="button" onClick={() => setFase('camara')} disabled={fase === 'guardando'}
                  className="flex h-16 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded border-2 border-dashed border-white/40 text-[10px] text-white/80">
                  <Plus className="h-5 w-5" /> Otra
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => moverPagina(-1)} disabled={sel === 0 || fase === 'guardando'} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" aria-label="Mover a la izquierda"><ChevronLeft className="h-5 w-5" /></button>
              <button type="button" onClick={() => moverPagina(1)} disabled={sel >= paginas.length - 1 || fase === 'guardando'} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" aria-label="Mover a la derecha"><ChevronRight className="h-5 w-5" /></button>
              <button type="button" onClick={borrarPagina} disabled={fase === 'guardando'} className="rounded-lg p-2 text-red-300 hover:bg-white/10" aria-label="Eliminar página"><Trash2 className="h-5 w-5" /></button>
              <button type="button" onClick={() => void guardar()} disabled={fase === 'guardando' || !paginas.length}
                className="ml-auto flex items-center gap-1.5 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold hover:bg-green-500 disabled:opacity-50">
                <Check className="h-5 w-5" /> Guardar {paginas.length > 1 ? `(${paginas.length} págs.)` : ''}
              </button>
            </div>
          </div>
        </>
      )}

      {trabajando && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60">
          <Loader2 className="h-8 w-8 animate-spin" /><p className="text-sm">{trabajando}</p>
        </div>
      )}

      <input ref={galeriaRef} type="file" accept="image/*" hidden onChange={desdeArchivo} />
      <input ref={nativaRef} type="file" accept="image/*" capture="environment" hidden onChange={desdeArchivo} />
    </div>,
    // En el body: así cubre toda la pantalla aunque se abra desde un modal o una lista con márgenes.
    document.body,
  )
}
