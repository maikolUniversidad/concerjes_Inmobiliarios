import { describe, it, expect } from 'vitest'
import {
  GRUPOS_PERMISOS, ALL_PERMISOS, TOTAL_PERMISOS,
  emptyPermisos, countActivos, labelPermiso, colorRol,
} from '@/lib/permisos'

describe('catálogo de permisos', () => {
  it('no tiene claves repetidas en el catálogo plano', () => {
    // Si se duplican, el contador "X de Y permisos activos" nunca llega al tope.
    const claves = ALL_PERMISOS.map((p) => p.key)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('TOTAL_PERMISOS coincide con el número de claves distintas', () => {
    expect(TOTAL_PERMISOS).toBe(Object.keys(emptyPermisos()).length)
  })

  it('cada grupo tiene nombre y al menos un permiso', () => {
    for (const g of GRUPOS_PERMISOS) {
      expect(g.grupo.trim().length).toBeGreaterThan(0)
      expect(g.permisos.length).toBeGreaterThan(0)
    }
  })

  it('cada permiso tiene clave en snake_case y etiqueta legible', () => {
    for (const p of ALL_PERMISOS) {
      expect(p.key, `clave inválida: ${p.key}`).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(p.label.trim().length, `sin etiqueta: ${p.key}`).toBeGreaterThan(0)
    }
  })

  it('dentro de un mismo grupo no se repite una clave', () => {
    for (const g of GRUPOS_PERMISOS) {
      const claves = g.permisos.map((p) => p.key)
      expect(new Set(claves).size, `claves repetidas en ${g.grupo}`).toBe(claves.length)
    }
  })

  it('conserva los permisos críticos que usan las pantallas', () => {
    const claves = new Set(ALL_PERMISOS.map((p) => p.key))
    for (const critico of [
      'ver_productos', 'ajustar_stock', 'crear_movimientos', 'gestionar_roles',
      'ver_ordenes_insumo', 'alistar_ordenes_insumo', 'recibir_ordenes_insumo',
      'ver_servicios_hogar', 'ver_personas', 'exportar_datos',
    ]) {
      expect(claves.has(critico), `falta el permiso ${critico}`).toBe(true)
    }
  })
})

describe('emptyPermisos / countActivos', () => {
  it('empieza con todo apagado', () => {
    const p = emptyPermisos()
    expect(countActivos(p)).toBe(0)
    expect(Object.values(p).every((v) => v === false)).toBe(true)
  })

  it('cuenta solo los activos', () => {
    expect(countActivos({ a: true, b: false, c: true })).toBe(2)
  })

  it('tolera null / undefined sin romper', () => {
    expect(countActivos(null)).toBe(0)
    expect(countActivos(undefined)).toBe(0)
  })

  it('marcar todo el catálogo llega al total', () => {
    const todos = Object.fromEntries(ALL_PERMISOS.map((p) => [p.key, true]))
    expect(countActivos(todos)).toBe(TOTAL_PERMISOS)
  })
})

describe('labelPermiso', () => {
  it('devuelve la etiqueta del catálogo', () => {
    expect(labelPermiso('ver_productos')).toBe('Ver productos')
  })

  it('si la clave no existe devuelve la clave (no rompe la pantalla)', () => {
    expect(labelPermiso('permiso_que_no_existe')).toBe('permiso_que_no_existe')
  })
})

describe('colorRol', () => {
  it('es determinista: el mismo rol siempre pinta igual', () => {
    expect(colorRol('SUPER_ADMIN')).toBe(colorRol('SUPER_ADMIN'))
  })

  it('siempre devuelve una clase de la paleta', () => {
    for (const rol of ['SUPER_ADMIN', 'ADMIN', 'Conserje', '', 'Ñandú']) {
      expect(colorRol(rol)).toMatch(/^bg-[a-z]+-100 text-[a-z]+-700$/)
    }
  })
})
