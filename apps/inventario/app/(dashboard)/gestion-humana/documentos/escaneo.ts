// Utilidades de escaneo: capturar páginas y fusionarlas en un solo PDF.

export interface Pagina {
  id: string
  dataUrl: string // JPEG data URL
  w: number
  h: number
}

function nuevoId() {
  return globalThis.crypto?.randomUUID?.() ?? `pg-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Convierte un frame de <video> en una página (JPEG), con recorte opcional. */
export function capturarDeVideo(video: HTMLVideoElement, opts?: { recorte?: Rect | null; calidad?: number }): Pagina {
  const calidad = opts?.calidad ?? 0.85
  const r = opts?.recorte
  const w = r ? r.w : (video.videoWidth || 1280)
  const h = r ? r.h : (video.videoHeight || 720)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  if (r) ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, w, h)
  else ctx.drawImage(video, 0, 0, w, h)
  return { id: nuevoId(), dataUrl: canvas.toDataURL('image/jpeg', calidad), w, h }
}

/** Muestra en escala de grises reducida del frame (para detectar movimiento). */
export function muestraGris(video: HTMLVideoElement, w = 64, h = 48): Uint8ClampedArray {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
  return g
}

/** Diferencia media (0..255) entre dos muestras — para saber si la cámara está quieta. */
export function diferencia(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): number {
  if (!a || !b || a.length !== b.length) return 999
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

function rangoContiguo(arr: Float32Array, minCount: number): [number, number] | null {
  let best: [number, number] | null = null
  let start = -1
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] >= minCount) { if (start < 0) start = i }
    else if (start >= 0) {
      if (!best || (i - 1 - start) > (best[1] - best[0])) best = [start, i - 1]
      start = -1
    }
  }
  if (start >= 0 && (!best || (arr.length - 1 - start) > (best[1] - best[0]))) best = [start, arr.length - 1]
  return best
}

/**
 * Detecta el borde del documento (región clara sobre fondo más oscuro) por
 * perfiles de proyección de luminancia. Devuelve el rectángulo en coordenadas
 * del video, o null si no encuentra un documento plausible.
 */
export function detectarDocumento(video: HTMLVideoElement): Rect | null {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return null
  const dw = 320, dh = Math.max(1, Math.round((dw * vh) / vw))
  const c = document.createElement('canvas'); c.width = dw; c.height = dh
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, 0, 0, dw, dh)
  const data = ctx.getImageData(0, 0, dw, dh).data

  const gray = new Float32Array(dw * dh)
  let sum = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    gray[p] = g; sum += g
  }
  const mean = sum / (dw * dh)
  const thr = mean * 1.06 // el papel suele ser más claro que el promedio

  const colBright = new Float32Array(dw)
  const rowBright = new Float32Array(dh)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (gray[y * dw + x] > thr) { colBright[x]++; rowBright[y]++ }
    }
  }
  const xs = rangoContiguo(colBright, dh * 0.35)
  const ys = rangoContiguo(rowBright, dw * 0.35)
  if (!xs || !ys) return null

  let [x0, x1] = xs
  let [y0, y1] = ys
  const mx = (x1 - x0) * 0.015, my = (y1 - y0) * 0.015
  x0 = Math.max(0, x0 - mx); x1 = Math.min(dw - 1, x1 + mx)
  y0 = Math.max(0, y0 - my); y1 = Math.min(dh - 1, y1 + my)
  const w = x1 - x0, h = y1 - y0

  const areaFrac = (w * h) / (dw * dh)
  if (areaFrac < 0.12 || areaFrac > 0.995) return null
  if (w < dw * 0.25 || h < dh * 0.2) return null

  const sx = vw / dw, sy = vh / dh
  return { x: Math.round(x0 * sx), y: Math.round(y0 * sy), w: Math.round(w * sx), h: Math.round(h * sy) }
}

/** Convierte un archivo de imagen (galería / cámara del móvil) en una página. */
export function archivoAPagina(file: File): Promise<Pagina> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'))
      img.onload = () => {
        // Re-encodear a JPEG para uniformar y reducir tamaño.
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        resolve({ id: nuevoId(), dataUrl: canvas.toDataURL('image/jpeg', 0.82), w: img.naturalWidth, h: img.naturalHeight })
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** Reduce una imagen y la devuelve como data URL JPEG (para enviar a la IA). */
export function imagenADataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'))
      img.onload = () => {
        const w = img.naturalWidth || 1
        const h = img.naturalHeight || 1
        const scale = Math.min(1, maxDim / Math.max(w, h))
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo procesar la imagen.'))
    img.src = url
  })
}

/** Gira la página 90° a la izquierda o derecha. */
export async function rotarPagina(pg: Pagina, dir: 'izq' | 'der'): Promise<Pagina> {
  const img = await cargarImagen(pg.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = pg.h
  canvas.height = pg.w
  const ctx = canvas.getContext('2d')!
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(dir === 'der' ? Math.PI / 2 : -Math.PI / 2)
  ctx.drawImage(img, -pg.w / 2, -pg.h / 2)
  return { id: pg.id, dataUrl: canvas.toDataURL('image/jpeg', 0.88), w: pg.h, h: pg.w }
}

/** Realza la página como documento: escala de grises + contraste. */
export async function mejorarPagina(pg: Pagina): Promise<Pagina> {
  const img = await cargarImagen(pg.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = pg.w
  canvas.height = pg.h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const imgData = ctx.getImageData(0, 0, pg.w, pg.h)
  const a = imgData.data
  const contraste = 1.4
  const brillo = 10
  for (let i = 0; i < a.length; i += 4) {
    let g = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114
    g = (g - 128) * contraste + 128 + brillo
    g = g < 0 ? 0 : g > 255 ? 255 : g
    a[i] = a[i + 1] = a[i + 2] = g
  }
  ctx.putImageData(imgData, 0, 0)
  return { id: pg.id, dataUrl: canvas.toDataURL('image/jpeg', 0.9), w: pg.w, h: pg.h }
}

/** Fusiona las páginas en un único PDF A4 (una imagen por página, centrada). */
export async function paginasAPdf(paginas: Pagina[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const margin = 16

  paginas.forEach((pg, i) => {
    if (i > 0) pdf.addPage()
    const maxW = pw - margin * 2
    const maxH = ph - margin * 2
    const ratio = Math.min(maxW / pg.w, maxH / pg.h)
    const w = pg.w * ratio
    const h = pg.h * ratio
    const x = (pw - w) / 2
    const y = (ph - h) / 2
    pdf.addImage(pg.dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST')
  })

  return pdf.output('blob')
}
