import { describe, it, expect } from 'vitest'
import { rangoSemana } from '@/lib/semana'

describe('rangoSemana', () => {
  it('convierte una semana ISO en su rango de lunes a lunes (hora Colombia)', () => {
    expect(rangoSemana('2026-W32')).toEqual({
      desde: '2026-08-03T05:00:00.000Z',
      hasta: '2026-08-10T05:00:00.000Z',
    })
  })

  it('la semana 1 puede empezar en diciembre del año anterior', () => {
    expect(rangoSemana('2026-W01')?.desde).toBe('2025-12-29T05:00:00.000Z')
  })

  it('acepta la semana 53 de los años largos', () => {
    expect(rangoSemana('2025-W53')?.desde).toBe('2025-12-29T05:00:00.000Z')
  })

  it('el borde siempre es medianoche de Bogotá (05:00 UTC) y cae en lunes', () => {
    for (const semana of ['2026-W01', '2026-W10', '2026-W32', '2026-W52']) {
      const r = rangoSemana(semana)!
      expect(r.desde.endsWith('T05:00:00.000Z'), semana).toBe(true)
      expect(new Date(r.desde).getUTCDay(), `${semana} no arranca en lunes`).toBe(1)
    }
  })

  it('el rango dura exactamente 7 días', () => {
    const r = rangoSemana('2026-W32')!
    expect(new Date(r.hasta).getTime() - new Date(r.desde).getTime()).toBe(7 * 24 * 3600_000)
  })

  it('semanas consecutivas quedan pegadas, sin huecos ni solapes', () => {
    const a = rangoSemana('2026-W32')!
    const b = rangoSemana('2026-W33')!
    expect(a.hasta).toBe(b.desde)
  })

  it('devuelve null cuando no hay semana o el formato es inválido', () => {
    for (const malo of [null, undefined, '', '2026-32', '2026W32', 'abcd-W01', '2026-W1']) {
      expect(rangoSemana(malo as string | null), String(malo)).toBeNull()
    }
  })

  it('rechaza números de semana fuera de rango', () => {
    expect(rangoSemana('2026-W00')).toBeNull()
    expect(rangoSemana('2026-W54')).toBeNull()
  })
})
