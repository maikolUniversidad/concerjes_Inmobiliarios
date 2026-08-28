import { describe, it, expect } from 'vitest'
import { cn, formatCOP, formatDate, formatFechaHora, formatHora, generateSKU, TZ_CO } from '@/lib/utils'

describe('cn', () => {
  it('junta clases y deja ganar a la última de Tailwind', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', false && 'oculto', 'font-bold')).toBe('text-sm font-bold')
  })
})

describe('formatCOP', () => {
  it('formatea en pesos, sin decimales y con separador de miles', () => {
    expect(formatCOP(18900)).toContain('18.900')
    expect(formatCOP(18900)).toContain('$')
    expect(formatCOP(18900)).not.toContain(',')
  })

  it('maneja el cero y los negativos', () => {
    expect(formatCOP(0)).toContain('0')
    expect(formatCOP(-5000)).toContain('5.000')
  })

  it('redondea los decimales en vez de mostrarlos', () => {
    expect(formatCOP(1234.56)).toContain('1.235')
  })
})

describe('fechas en hora de Colombia', () => {
  it('usa la zona horaria de Bogotá', () => {
    expect(TZ_CO).toBe('America/Bogota')
  })

  it('una hora UTC de la madrugada sigue siendo el día anterior en Colombia', () => {
    // Regresión: en Vercel (UTC) un movimiento de las 9 p. m. se veía al día siguiente.
    expect(formatDate('2026-08-27T02:00:00Z')).toBe('26/08/2026')
    expect(formatFechaHora('2026-08-27T02:00:00Z')).toContain('26/08/2026')
    expect(formatHora('2026-08-27T02:00:00Z')).toContain('9:00')
  })

  it('acepta Date además de string', () => {
    expect(formatDate(new Date('2026-08-27T15:00:00Z'))).toBe('27/08/2026')
  })
})

describe('generateSKU', () => {
  it('arma el SKU con categoría, año y consecutivo', () => {
    expect(generateSKU('ASEO', 2026, 7)).toBe('CI-ASEO-2026-0007')
  })

  it('recorta la categoría a 4 letras', () => {
    expect(generateSKU('CAFETERIA', 2026, 1)).toBe('CI-CAFE-2026-0001')
  })

  it('rellena con X las categorías cortas', () => {
    expect(generateSKU('EPP', 2026, 1)).toBe('CI-EPPX-2026-0001')
  })

  it('pasa la categoría a mayúsculas', () => {
    expect(generateSKU('aseo', 2026, 1)).toBe('CI-ASEO-2026-0001')
  })

  it('no recorta consecutivos de más de 4 dígitos', () => {
    expect(generateSKU('ASEO', 2026, 12345)).toBe('CI-ASEO-2026-12345')
  })
})
