// Lo que el dispositivo calcula de cada foto ANTES de subirla (ADR-02 §2.9:
// «qué se valida en el dispositivo, sin conexión»).
//
// Nada de esto puntúa: puntuar es de F13. Lo que se hace aquí es dejar los datos
// bien registrados y que la pantalla pueda avisar a tiempo:
//
//   · comprimir — una foto de 4 MB por una red de sótano no sube nunca, y el
//     cuerpo de una función de Vercel está limitado a 4,5 MB. A 1.280 px de
//     lado largo y calidad 0,82 una foto de ronda pesa 150–400 KB y se sigue
//     viendo si la llave gotea;
//   · sha256 — la huella del archivo exacto. Es lo que la base exige;
//   · dHash — huella perceptual de 64 bits: atrapa la misma foto recomprimida o
//     recortada, que es lo que el sha256 no ve. El cálculo robusto (pHash) y la
//     comparación global son de F13; esto es lo que se puede hacer en el
//     celular y sin red;
//   · leer el QR dentro de la imagen — con `BarcodeDetector`, que es nativo en
//     Chrome de Android (el navegador de casi todos estos celulares). Si no
//     está, no se lee y la columna queda en NULL: una foto sin QR legible es
//     mala suerte, no fraude, y eso lo pesa F13.

export interface FotoPreparada {
  blob: Blob
  mime: string
  ancho: number
  alto: number
  tamano: number
  sha256: string
  hashPerceptual: string
  qrDetectado: string | null
}

const LADO_MAX = 1280
const CALIDAD = 0.82

/** SHA-256 en hexadecimal, con la API del navegador. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function aBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  // Safari viejo: por <img>.
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // La URL se revoca después de decodificar: el bitmap ya está en memoria.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function lienzo(ancho: number, alto: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = ancho
  c.height = alto
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Este navegador no puede procesar la foto.')
  return { c, ctx }
}

/**
 * dHash de 64 bits: se reduce la imagen a 9×8 en gris y se compara cada pixel
 * con el de su derecha. Dos fotos de la misma escena dan hashes a pocos bits de
 * distancia aunque cambien de tamaño o de compresión.
 */
export async function dHash(fuente: ImageBitmap | HTMLImageElement): Promise<string> {
  const { ctx } = lienzo(9, 8)
  ctx.drawImage(fuente as CanvasImageSource, 0, 0, 9, 8)
  const d = ctx.getImageData(0, 0, 9, 8).data
  const gris = (x: number, y: number) => {
    const i = (y * 9 + x) * 4
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  let bits = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += gris(x, y) > gris(x + 1, y) ? '1' : '0'
  }
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** Distancia de Hamming entre dos dHash. Menos de 10 bits = «es la misma foto». */
export function distanciaHash(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

interface DetectorCodigo {
  detect(fuente: CanvasImageSource | Blob): Promise<{ rawValue: string; format: string }[]>
}
interface VentanaConDetector {
  BarcodeDetector?: new (op?: { formats?: string[] }) => DetectorCodigo
}

/** Lee un QR dentro de la imagen. `null` si el navegador no sabe o no hay QR. */
export async function leerQrEnImagen(fuente: ImageBitmap | HTMLImageElement | Blob): Promise<string | null> {
  const w = globalThis as unknown as VentanaConDetector
  if (!w.BarcodeDetector) return null
  try {
    const det = new w.BarcodeDetector({ formats: ['qr_code'] })
    const codigos = await det.detect(fuente as CanvasImageSource)
    return codigos[0]?.rawValue ?? null
  } catch {
    return null
  }
}

/**
 * Comprime, mide y marca una foto recién tomada. Devuelve todo lo que
 * `ronda_adjuntar_evidencia()` espera en su `p_meta`.
 */
export async function prepararFoto(original: Blob): Promise<FotoPreparada> {
  const bitmap = await aBitmap(original)
  const anchoOrig = 'width' in bitmap ? bitmap.width : 0
  const altoOrig = 'height' in bitmap ? bitmap.height : 0
  const escala = Math.min(1, LADO_MAX / Math.max(anchoOrig, altoOrig || 1))
  const ancho = Math.max(1, Math.round(anchoOrig * escala))
  const alto = Math.max(1, Math.round(altoOrig * escala))

  const { c, ctx } = lienzo(ancho, alto)
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, ancho, alto)

  const blob = await new Promise<Blob>((resolver, rechazar) => {
    c.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo preparar la foto.'))),
      'image/jpeg', CALIDAD)
  })

  // El QR se lee en la imagen ORIGINAL: la reducida puede perder el patrón.
  const qr = await leerQrEnImagen(bitmap)

  return {
    blob,
    mime: 'image/jpeg',
    ancho,
    alto,
    tamano: blob.size,
    sha256: await sha256Hex(blob),
    hashPerceptual: await dHash(bitmap),
    qrDetectado: qr,
  }
}

/** Convierte el PNG en data URL del PadFirma en un Blob para subirlo. */
export function dataUrlABlob(dataUrl: string): Blob {
  const [cabeza, datos] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(cabeza)?.[1] ?? 'image/png'
  const bin = atob(datos)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
