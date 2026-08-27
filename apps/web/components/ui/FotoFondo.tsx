/**
 * Foto de fondo con degradado de respaldo.
 *
 * La imagen se pinta como `background-image` SOBRE un degradado de marca. Si el
 * archivo todavía no existe en `/public`, el navegador simplemente no pinta la
 * capa y queda el degradado: la página nunca muestra un hueco roto ni el icono
 * de imagen rota. Así el sitio se ve terminado antes y después de cargar las
 * fotos definitivas.
 *
 * No usa `next/image` a propósito: `next/image` con un archivo inexistente
 * rompe el renderizado, y aquí la tolerancia al archivo faltante es el punto.
 */
export function FotoFondo({
  src,
  degradado = 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 45%, #388E3C 100%)',
  opacidad = 1,
  posicion = 'center',
  className = '',
}: {
  /** Ruta pública de la foto, p. ej. `/images/servicios-hogar/hero.jpg`. */
  src?: string
  /**
   * Degradado que se ve mientras la foto no exista (o detrás de ella).
   * Pásalo en `null` cuando el respaldo lo dé una clase de Tailwind en
   * `className` (p. ej. `bg-gradient-to-br from-green-500 to-emerald-600`).
   */
  degradado?: string | null
  /** Opacidad de la capa de foto (útil para que el texto encima respire). */
  opacidad?: number
  posicion?: string
  className?: string
}) {
  return (
    <div className={`absolute inset-0 ${className}`} aria-hidden="true">
      {degradado && <div className="absolute inset-0" style={{ background: degradado }} />}
      {src && (
        <div
          className="absolute inset-0 bg-cover bg-no-repeat"
          style={{ backgroundImage: `url('${src}')`, backgroundPosition: posicion, opacity: opacidad }}
        />
      )}
    </div>
  )
}

/**
 * Velo oscuro para garantizar contraste del texto blanco sobre cualquier foto.
 * `desde`/`hasta` permiten ajustar la intensidad por bloque.
 */
export function Velo({
  className = '',
  estilo = 'linear-gradient(to bottom, rgba(12,40,15,.78) 0%, rgba(12,40,15,.62) 45%, rgba(12,40,15,.80) 100%)',
}: {
  className?: string
  estilo?: string
}) {
  return <div className={`absolute inset-0 ${className}`} style={{ background: estilo }} aria-hidden="true" />
}
