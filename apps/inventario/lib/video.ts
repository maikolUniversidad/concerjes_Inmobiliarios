/**
 * Utilidades para los videos grabados en el navegador (MediaRecorder).
 *
 * El WebM que produce MediaRecorder **no trae la duración en la cabecera**: el
 * muxer la escribiría al cerrar el archivo, pero como el archivo se va armando
 * en vivo nunca la escribe. Por eso el reproductor muestra `0:00 / 0:00` y la
 * barra de progreso no se puede arrastrar, incluso con videos perfectos.
 *
 * `duracionDeVideo` la calcula; `duracionReal` la arregla en un `<video>` ya
 * montado. Las dos usan el mismo truco: pedirle al navegador que salte a un
 * instante imposible obliga a recorrer el archivo hasta el final, y ahí sí sabe
 * cuánto dura.
 */

/** Un video más corto que esto no prueba nada de un despacho. */
export const VIDEO_MIN_SEGUNDOS = 3

/** Salto imposible que fuerza al navegador a buscar el final del archivo. */
const MUY_LEJOS = 1e101

/**
 * Duración en segundos de un blob de video, o `null` si no se pudo medir.
 * Nunca lanza: quien la usa decide qué hacer con el `null`.
 */
export function duracionDeVideo(blob: Blob): Promise<number | null> {
  return new Promise((resolver) => {
    const url = URL.createObjectURL(blob)
    const el = document.createElement('video')
    let terminado = false

    const terminar = (valor: number | null) => {
      if (terminado) return
      terminado = true
      clearTimeout(reloj)
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
      resolver(valor)
    }

    // Si el archivo está corrupto el navegador puede no emitir ningún evento.
    const reloj = setTimeout(() => terminar(null), 5000)

    el.preload = 'metadata'
    el.muted = true
    el.onerror = () => terminar(null)
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) return terminar(el.duration)
      // Duración desconocida (Infinity): se fuerza el recorrido hasta el final.
      el.ontimeupdate = () => {
        el.ontimeupdate = null
        terminar(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null)
      }
      el.currentTime = MUY_LEJOS
    }
    el.src = url
  })
}

/**
 * Arregla la duración de un `<video>` ya montado cuyo archivo no la declara.
 * Se llama desde `onLoadedMetadata`; si la duración ya es válida no hace nada.
 */
export function duracionReal(el: HTMLVideoElement) {
  if (Number.isFinite(el.duration) && el.duration > 0) return
  const alSaltar = () => {
    el.removeEventListener('timeupdate', alSaltar)
    // Volver al inicio: el salto dejó el cabezal al final del video.
    el.currentTime = 0
  }
  el.addEventListener('timeupdate', alSaltar)
  el.currentTime = MUY_LEJOS
}
