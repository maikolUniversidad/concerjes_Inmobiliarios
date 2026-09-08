import { describe, it, expect } from 'vitest'
import {
  agregarPreferencia, firmaFiltros, limpiarFiltros, MAX_PREFERENCIAS,
  type PreferenciaFiltro,
} from '@/lib/filtros-preferencias'
import { etiquetaSemana } from '@/lib/clasificacion'
import { TIPO_MOV_META, ORDEN_TIPOS_MOV, leerTipoMov } from '@/lib/movimientos'

const pref = (nombre: string, filtros: Record<string, string>): PreferenciaFiltro =>
  ({ id: nombre, nombre, filtros })

describe('firma de filtros', () => {
  it('no depende del orden de las claves ni de las etiquetas', () => {
    expect(firmaFiltros({ tipo: 'DIRECTO', etq: 'b,a' }))
      .toBe(firmaFiltros({ etq: 'a,b', tipo: 'DIRECTO' }))
  })

  it('ignora valores vacíos, para que "sin filtros" sea una sola firma', () => {
    expect(firmaFiltros({ tipo: '', etq: '' })).toBe('')
    expect(firmaFiltros({})).toBe('')
  })

  it('distingue combinaciones diferentes', () => {
    expect(firmaFiltros({ tipo: 'DIRECTO' })).not.toBe(firmaFiltros({ tipo: 'PRIVADO' }))
    expect(firmaFiltros({ etq: 'a' })).not.toBe(firmaFiltros({ etq: 'a,b' }))
  })

  it('incluye el tipo de movimiento y la semana', () => {
    const base = { tipo: 'DIRECTO', etq: 'a' }
    expect(firmaFiltros({ ...base, mov: 'SALIDA' })).not.toBe(firmaFiltros(base))
    expect(firmaFiltros({ ...base, semana: '2026-W35' })).not.toBe(firmaFiltros({ ...base, semana: '2026-W36' }))
    expect(firmaFiltros({ mov: 'SALIDA', semana: '2026-W35' }))
      .toBe(firmaFiltros({ semana: '2026-W35', mov: 'SALIDA' }))
  })
})

describe('filtros extra de movimientos', () => {
  it('guarda una vista sólo con tipo de movimiento y semana', () => {
    const lista = agregarPreferencia([], 'Salidas de la semana', { mov: 'SALIDA', semana: '2026-W35' }, 'id1')
    expect(lista[0].filtros).toEqual({ mov: 'SALIDA', semana: '2026-W35' })
  })

  it('sólo acepta tipos de movimiento conocidos', () => {
    expect(leerTipoMov('salida')).toBe('SALIDA')
    expect(leerTipoMov('SALIDA')).toBe('SALIDA')
    expect(leerTipoMov('CUALQUIERA')).toBeNull()
    expect(leerTipoMov(null)).toBeNull()
  })

  it('cada tipo de movimiento tiene nombre y badge', () => {
    expect(Object.keys(TIPO_MOV_META).sort()).toEqual([...ORDEN_TIPOS_MOV].sort())
    for (const [t, meta] of Object.entries(TIPO_MOV_META)) {
      expect(meta.label.trim().length, t).toBeGreaterThan(0)
      expect(meta.badge, t).toMatch(/^bg-\S+ text-\S+$/)
    }
  })
})

describe('etiqueta de semana', () => {
  it('vuelve legible la semana ISO', () => {
    expect(etiquetaSemana('2026-W35')).toBe('Semana 35 · 2026')
    expect(etiquetaSemana('2026-W07')).toBe('Semana 7 · 2026')
  })

  it('deja pasar un valor que no tenga esa forma', () => {
    expect(etiquetaSemana('sin-semana')).toBe('sin-semana')
  })
})

describe('limpiarFiltros', () => {
  it('descarta las claves sin valor', () => {
    expect(limpiarFiltros({ tipo: 'DIRECTO', etq: '' })).toEqual({ tipo: 'DIRECTO' })
  })
})

describe('agregar preferencias', () => {
  it('agrega la combinación con su nombre', () => {
    const lista = agregarPreferencia([], 'Directos', { tipo: 'DIRECTO', etq: '' }, 'id1')
    expect(lista).toEqual([{ id: 'id1', nombre: 'Directos', filtros: { tipo: 'DIRECTO' } }])
  })

  it('reemplaza la que tenga el mismo nombre en vez de duplicarla', () => {
    const previa = [pref('Directos', { tipo: 'DIRECTO' })]
    const lista = agregarPreferencia(previa, 'directos', { tipo: 'PRIVADO' }, 'id2')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toEqual({ id: 'id2', nombre: 'directos', filtros: { tipo: 'PRIVADO' } })
  })

  it('ignora nombres vacíos y combinaciones sin filtros', () => {
    expect(agregarPreferencia([], '   ', { tipo: 'DIRECTO' }, 'id1')).toEqual([])
    expect(agregarPreferencia([], 'Todo', { tipo: '' }, 'id1')).toEqual([])
  })

  it('no crece más allá del tope, descartando la más antigua', () => {
    let lista: PreferenciaFiltro[] = []
    for (let i = 0; i < MAX_PREFERENCIAS + 3; i++) {
      lista = agregarPreferencia(lista, `Vista ${i}`, { etq: `e${i}` }, `id${i}`)
    }
    expect(lista).toHaveLength(MAX_PREFERENCIAS)
    expect(lista[0].nombre).toBe('Vista 3')
    expect(lista[lista.length - 1].nombre).toBe(`Vista ${MAX_PREFERENCIAS + 2}`)
  })
})
