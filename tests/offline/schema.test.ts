import { describe, it, expect } from 'vitest'
import { TABLAS_SYNC, watermarkCol, EPOCH } from '../../packages/offline/src/schema'

describe('esquema de sincronización', () => {
  it('no repite tablas', () => {
    const nombres = TABLAS_SYNC.map((t) => t.tabla)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('la columna watermark por defecto depende del modo', () => {
    expect(watermarkCol({ tabla: 'productos', modo: 'incremental' })).toBe('updated_at')
    expect(watermarkCol({ tabla: 'movimientos', modo: 'append' })).toBe('created_at')
    expect(watermarkCol({ tabla: 'x', modo: 'append', tsCol: 'fecha' })).toBe('fecha')
  })

  it('movimientos es un ledger de solo inserción', () => {
    const mov = TABLAS_SYNC.find((t) => t.tabla === 'movimientos')
    expect(mov?.modo).toBe('append')
    expect(watermarkCol(mov!)).toBe('created_at')
  })

  it('EPOCH es una fecha ISO válida y anterior a cualquier dato real', () => {
    expect(new Date(EPOCH).getTime()).toBe(0)
    expect(EPOCH < '2020-01-01T00:00:00.000Z').toBe(true)
  })
})
