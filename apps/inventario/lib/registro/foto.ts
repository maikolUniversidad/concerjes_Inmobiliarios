// Foto de perfil del candidato (tipo carné): recorte vertical 3:4, tamaño
// liviano y JPEG, para que se vea igual en el expediente, en "Mi proceso" y en
// los formatos impresos (hoja de vida, actualización de datos, resultados de
// las pruebas). Se usa igual con la cámara que con un archivo elegido.

export const FOTO_ANCHO = 600
export const FOTO_ALTO = 800

/** Zona centrada, vertical 3:4 y lo más grande posible dentro de la imagen. */
export function recorteCarnet(ancho: number, alto: number): { sx: number; sy: number; sw: number; sh: number } {
  let sw = ancho
  let sh = Math.round((sw * 4) / 3)
  if (sh > alto) {
    sh = alto
    sw = Math.round((sh * 3) / 4)
  }
  return { sx: Math.round((ancho - sw) / 2), sy: Math.round((alto - sh) / 2), sw, sh }
}

/** Dibuja el recorte carné de una imagen o del video de la cámara y lo devuelve como JPEG. */
export function carnetDesde(fuente: CanvasImageSource, ancho: number, alto: number): Promise<Blob> {
  const r = recorteCarnet(ancho, alto)
  const escala = Math.min(1, FOTO_ALTO / r.sh)
  const w = Math.round(r.sw * escala)
  const h = Math.round(r.sh * escala)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('No se pudo procesar la foto.'))
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(fuente, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h)
  return new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.9))
}

export function archivoFoto(blob: Blob): File {
  return new File([blob], 'foto-perfil.jpg', { type: 'image/jpeg' })
}

/** Convierte una imagen elegida del equipo en la foto de perfil (recortada y liviana). */
export async function prepararFotoPerfil(file: File): Promise<File> {
  const img = await cargarImagen(file)
  try {
    return archivoFoto(await carnetDesde(img.fuente, img.ancho, img.alto))
  } finally {
    img.liberar()
  }
}

async function cargarImagen(file: File): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number; liberar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Respeta la orientación de la foto del celular (EXIF).
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { fuente: b, ancho: b.width, alto: b.height, liberar: () => b.close() }
    } catch { /* se intenta con <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => mal(new Error('No pudimos leer esa imagen. Usa una foto JPG o PNG, o tómala con la cámara.'))
      i.src = url
    })
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}
