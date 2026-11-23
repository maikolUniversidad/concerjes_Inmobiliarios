import { describe, it, expect } from 'vitest'
import { separarHojasInventario, type HojaInforme } from '@/lib/reportes/informes'

const cols = [
  { header: 'Producto', key: 'producto' },
  { header: 'Tipo', key: 'tipo' },
]
const hojaProductos: HojaInforme = {
  nombre: 'Inventario',
  columnas: cols,
  nota: 'Ordenado por ítem y nombre. Usa los filtros de la fila 1 para acotar.',
  filas: [
    { producto: 'TINTO', tipo: 'CAFETERIA' },
    { producto: 'BRILLADORA', tipo: 'MAQUINARIA' },
    { producto: 'JABÓN', tipo: 'ASEO' },
    { producto: 'AZÚCAR', tipo: 'CAFETERIA' },
  ],
}
const hojaTotales: HojaInforme = {
  nombre: 'Por tipo de insumo',
  columnas: [{ header: 'Tipo de insumo', key: 'grupo' }],
  filas: [{ grupo: 'ASEO' }],
}

describe('informes de inventario: Cafetería y Maquinaria aparte', () => {
  const hojas = separarHojasInventario([hojaProductos, hojaTotales])

  it('parte cada hoja de productos en resto, Cafetería y Maquinaria', () => {
    expect(hojas.map(h => h.nombre)).toEqual([
      'Inventario', 'Inventario · Cafetería', 'Inventario · Maquinaria', 'Por tipo de insumo',
    ])
    expect(hojas[0].filas.map(f => f.producto)).toEqual(['JABÓN'])
    expect(hojas[1].filas.map(f => f.producto)).toEqual(['TINTO', 'AZÚCAR'])
    expect(hojas[2].filas.map(f => f.producto)).toEqual(['BRILLADORA'])
  })

  it('no pierde ni repite productos', () => {
    const total = hojas.slice(0, 3).reduce((a, h) => a + h.filas.length, 0)
    expect(total).toBe(hojaProductos.filas.length)
  })

  it('marca las hojas de productos para ir en orden alfabético y ajusta la nota', () => {
    for (const h of hojas.slice(0, 3)) {
      expect(h.orden).toBe('alfabetico')
      expect(h.nota).toMatch(/^Ordenado alfabéticamente por producto/)
      expect(h.nota).not.toMatch(/por ítem y nombre/)
    }
  })

  it('deja intactas las hojas de totales', () => {
    expect(hojas[3]).toBe(hojaTotales)
  })

  it('respeta el máximo de 31 caracteres de Excel en el nombre de la hoja', () => {
    const largo = separarHojasInventario([{ ...hojaProductos, nombre: 'Un nombre de hoja bastante largo' }])
    // La hoja base la recorta descargarInforme al escribirla; aquí, las nuevas.
    for (const h of largo.slice(1)) expect(h.nombre.length).toBeLessThanOrEqual(31)
    expect(largo[2].nombre.endsWith(' · Maquinaria')).toBe(true)
  })
})
