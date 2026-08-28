import { describe, it, expect } from 'vitest'
import {
  TIPO_CONTRATO_META, TIPO_CONTRATO_OPCIONES,
  ETIQUETA_COLORES, ETIQUETA_COLOR_NOMBRES, colorEtiqueta,
} from '@/lib/clasificacion'

describe('tipos de contrato', () => {
  it('las opciones del selector coinciden con el catálogo de metadatos', () => {
    expect(TIPO_CONTRATO_OPCIONES.map((o) => o.value).sort())
      .toEqual(Object.keys(TIPO_CONTRATO_META).sort())
  })

  it('cada tipo tiene etiqueta y badge', () => {
    for (const [tipo, meta] of Object.entries(TIPO_CONTRATO_META)) {
      expect(meta.label.trim().length, tipo).toBeGreaterThan(0)
      expect(meta.badge, tipo).toMatch(/^bg-\S+ text-\S+$/)
    }
  })
})

describe('colores de etiqueta', () => {
  it('devuelve el color pedido', () => {
    expect(colorEtiqueta('blue')).toBe(ETIQUETA_COLORES.blue)
  })

  it('cae en gris cuando el color es desconocido, null o undefined', () => {
    expect(colorEtiqueta('fucsia')).toBe(ETIQUETA_COLORES.gray)
    expect(colorEtiqueta(null)).toBe(ETIQUETA_COLORES.gray)
    expect(colorEtiqueta(undefined)).toBe(ETIQUETA_COLORES.gray)
  })

  it('la lista de nombres cubre toda la paleta', () => {
    expect(ETIQUETA_COLOR_NOMBRES.sort()).toEqual(Object.keys(ETIQUETA_COLORES).sort())
    expect(ETIQUETA_COLOR_NOMBRES).toContain('gray')
  })

  it('cada color trae clases de badge y de punto', () => {
    for (const [nombre, c] of Object.entries(ETIQUETA_COLORES)) {
      expect(c.badge, nombre).toMatch(/^bg-\S+ text-\S+$/)
      expect(c.dot, nombre).toMatch(/^bg-\S+$/)
    }
  })
})
