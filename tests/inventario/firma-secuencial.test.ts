import { describe, it, expect } from 'vitest'
import { siguientePendiente, resumenFirma, retomarOmitidos, type EstadoFirma } from '@/lib/ats/firma-secuencial'
import { modoEscaneo, MAX_PAGINAS_PDF } from '@/lib/escaner/salida'

describe('firmar uno tras otro', () => {
  it('pasa al siguiente por firmar y salta los ya firmados', () => {
    const e: EstadoFirma[] = ['firmado', 'pendiente', 'firmado', 'pendiente']
    expect(siguientePendiente(e, 0)).toBe(1)
    expect(siguientePendiente(e, 1)).toBe(3)
    expect(siguientePendiente(e, -1)).toBe(1)
  })

  it('si se empezó por la mitad, al final vuelve a los de arriba', () => {
    const e: EstadoFirma[] = ['pendiente', 'pendiente', 'firmado', 'firmado']
    expect(siguientePendiente(e, 3)).toBe(0)
    expect(siguientePendiente(e, 2)).toBe(0)
  })

  it('no vuelve a mostrar los omitidos y termina cuando no queda nada', () => {
    const e: EstadoFirma[] = ['firmado', 'omitido', 'firmado']
    expect(siguientePendiente(e, 0)).toBe(-1)
    expect(siguientePendiente([], -1)).toBe(-1)
    expect(resumenFirma(e)).toEqual({ firmados: 2, omitidos: 1, pendientes: 0, total: 3 })
    const otra = retomarOmitidos(e)
    expect(otra).toEqual(['firmado', 'pendiente', 'firmado'])
    expect(siguientePendiente(otra, -1)).toBe(1)
  })

  it('el único pendiente es el actual: se queda en él', () => {
    expect(siguientePendiente(['firmado', 'pendiente'], 1)).toBe(1)
  })
})

describe('cómo se guarda un escaneo', () => {
  const tipo = (min: number, max: number, formatos: string[] | null = ['pdf', 'jpg', 'jpeg', 'png']) =>
    ({ min_archivos: min, max_archivos: max, formatos_permitidos: formatos })

  it('la cédula (frente y reverso) va como una foto por cara', () => {
    expect(modoEscaneo(tipo(2, 2))).toEqual({ salida: 'imagenes', maxPaginas: 2 })
    expect(modoEscaneo(tipo(2, 2), 1)).toEqual({ salida: 'imagenes', maxPaginas: 1 })
  })

  it('un certificado de varias hojas va en un solo PDF aunque el tipo admita un archivo', () => {
    expect(modoEscaneo(tipo(1, 1))).toEqual({ salida: 'pdf', maxPaginas: MAX_PAGINAS_PDF })
    expect(modoEscaneo(tipo(0, 10), 3)).toEqual({ salida: 'pdf', maxPaginas: MAX_PAGINAS_PDF })
    expect(modoEscaneo(tipo(1, 1, null)).salida).toBe('pdf')
  })

  it('si el tipo no admite PDF, guarda fotos hasta llenar el cupo', () => {
    expect(modoEscaneo(tipo(1, 3, ['jpg', 'jpeg', 'png']), 1)).toEqual({ salida: 'imagenes', maxPaginas: 2 })
  })
})
