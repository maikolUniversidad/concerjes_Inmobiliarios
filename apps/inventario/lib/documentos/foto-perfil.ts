// Foto de perfil del candidato lista para incrustar en un documento generado
// (solo servidor). Se descarga con la sesión de quien genera, así que respeta
// los permisos del bucket. Solo imágenes livianas que cualquier navegador
// muestra; si no hay foto o no sirve, el documento queda con el recuadro.

/* eslint-disable @typescript-eslint/no-explicit-any */

const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

/** Tamaño máximo que se incrusta (las fotos nuevas pesan ~100 KB). */
export const MAX_FOTO_INCRUSTADA = 700 * 1024

export async function fotoPerfilDataUrl(sb: any, candidatoId: string): Promise<string | null> {
  try {
    const { data: c } = await sb.from('candidatos').select('foto_perfil_path').eq('id', candidatoId).maybeSingle()
    const path: string | undefined = c?.foto_perfil_path
    if (!path) return null
    const { data: blob, error } = await sb.storage.from('registro-vacantes').download(path)
    if (error || !blob) return null
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const mime = /^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type : MIME_POR_EXTENSION[ext]
    if (!mime || blob.size > MAX_FOTO_INCRUSTADA) return null
    return `data:${mime};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
  } catch {
    return null
  }
}
