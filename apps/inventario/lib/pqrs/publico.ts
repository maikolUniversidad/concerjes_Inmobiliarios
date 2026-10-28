// PQRS radicada desde el QR de un punto de control, sin cuenta (F5 de Puntos QR).
//
// Aquí vive lo que no es ni consulta ni pantalla: el hash de la IP, los límites
// de la foto y los tipos que viajan entre la página pública y su route handler.
// No importa Supabase a propósito, para que las pruebas
// (`scripts/probar-puntos-qr-f5.mjs`) puedan importar este archivo tal cual y
// comprobar que el hash que calcula la aplicación es el que termina en la base.
//
// Quién hace qué, que es la decisión central de esta fase:
//   · la PÁGINA (`app/q/[token]/pqrs`) resuelve el código con la misma
//     `resolverCodigo()` de F2 — forma, existencia, FIRMA, estado del QR,
//     vigencia del contrato, estado del punto — y pregunta a la base si este
//     contrato recibe PQRS pública;
//   · el ROUTE HANDLER (`/api/pqrs/publica`) calcula el `ip_hash`, sube la foto
//     con la llave de servicio y llama a `pqrs_radicar_publica()`;
//   · la BASE vuelve a validar todo lo que puede validar sin la llave de firma.
// La llave de servicio nunca sale del servidor y el navegador nunca manda el
// `ip_hash`: si lo mandara, saltarse el límite sería editar un campo.

/** Hasta dos fotos: es un reporte de un residente desde el celular, no un
 *  expediente. Y el tope por archivo es bajo a propósito, porque esta ruta
 *  recibe archivos SIN sesión. */
export const MAX_FOTOS_PUBLICAS = 2
// El tope es DESPUÉS de comprimir en el celular, y es bajo por dos razones: el
// cuerpo de una función de Vercel está limitado a 4,5 MB (las dos fotos van en
// la misma petición), y esta ruta recibe archivos SIN sesión.
export const MAX_BYTES_FOTO_PUBLICA = 2 * 1024 * 1024
export const MIMES_FOTO_PUBLICA = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/** Calidades que un residente puede elegir desde la calle. Las otras
 *  (`COLABORADOR`, `PROVEEDOR`, `ADMINISTRACION`…) las pone quien radica desde
 *  la consola, porque implican una relación que aquí nadie puede comprobar. */
export const CALIDADES_PUBLICAS = ['RESIDENTE', 'PROPIETARIO', 'OTRO'] as const
export type CalidadPublica = (typeof CALIDADES_PUBLICAS)[number]

export interface CategoriaPublica {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  tipo_sugerido: string
  prioridad_sugerida: string
}

/** Lo que el formulario manda al servidor. Nunca incluye el `ip_hash`. */
export interface RadicacionPublica {
  codigo: string
  categoria: string
  asunto?: string
  descripcion: string
  anonima: boolean
  nombre?: string
  calidad?: CalidadPublica
  telefono?: string
  email?: string
  modo?: 'QR' | 'MANUAL'
}

/** Mensaje de error de una foto que no se puede aceptar, o null si está bien. */
export function problemaDeFoto(nombre: string, bytes: number, mime: string): string | null {
  if (!MIMES_FOTO_PUBLICA.includes(mime.toLowerCase())) {
    return `"${nombre}" no es una foto (solo JPG, PNG, WEBP o HEIC).`
  }
  if (bytes > MAX_BYTES_FOTO_PUBLICA) return `"${nombre}" pesa más de 2 MB, incluso después de comprimirla.`
  if (bytes <= 0) return `"${nombre}" llegó vacía.`
  return null
}
