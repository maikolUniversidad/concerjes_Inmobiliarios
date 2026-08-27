import Image from 'next/image'

/**
 * Bloque de imagen con relación de aspecto fija.
 *
 * Detrás de la foto queda un tono de marca, así que mientras carga (o si el
 * archivo faltara) el bloque se ve como un espacio de color y no como un hueco
 * roto. Reemplaza los recuadros punteados de "[ Foto del servicio ]" que traía
 * la maqueta original.
 */
export function Foto({
  src,
  alt,
  ratio = 'aspect-[4/3]',
  className = '',
  posicion = 'center',
  sizes = '(max-width: 1024px) 100vw, 50vw',
  prioridad = false,
}: {
  src: string
  alt: string
  /** Clase de relación de aspecto, p. ej. `aspect-video` o `aspect-[21/6]`. */
  ratio?: string
  className?: string
  /** `object-position` de la foto dentro del marco. */
  posicion?: string
  sizes?: string
  prioridad?: boolean
}) {
  return (
    <div className={`relative overflow-hidden bg-brand-green/10 ${ratio} ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={prioridad}
        className="object-cover"
        style={{ objectPosition: posicion }}
      />
    </div>
  )
}
