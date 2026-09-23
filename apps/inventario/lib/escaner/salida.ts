// Cómo se guarda un escaneo según el tipo de documento.

export interface TipoEscaneable {
  formatos_permitidos?: string[] | null
  min_archivos: number
  max_archivos: number
}

export interface ModoEscaneo {
  /** 'pdf': todas las páginas en un solo archivo; 'imagenes': un JPG por página. */
  salida: 'pdf' | 'imagenes'
  maxPaginas: number
}

/** Tope de páginas de un PDF escaneado (un contrato largo cabe de sobra). */
export const MAX_PAGINAS_PDF = 30

/**
 * Los tipos que piden varios archivos por obligación (la cédula: frente y
 * reverso) se guardan como una foto por página, porque cada cara se revisa por
 * aparte. Todo lo demás va como un solo PDF con sus páginas en orden: así un
 * certificado de dos hojas cuenta como un archivo y no llena el cupo del tipo.
 */
export function modoEscaneo(tipo: TipoEscaneable, yaSubidos = 0): ModoEscaneo {
  const formatos = tipo.formatos_permitidos ?? []
  const admite = (ext: string) => formatos.length === 0 || formatos.includes(ext)
  const restantes = Math.max(1, tipo.max_archivos - yaSubidos)
  if (tipo.min_archivos >= 2 && admite('jpg')) return { salida: 'imagenes', maxPaginas: restantes }
  if (admite('pdf')) return { salida: 'pdf', maxPaginas: MAX_PAGINAS_PDF }
  return { salida: 'imagenes', maxPaginas: restantes }
}
