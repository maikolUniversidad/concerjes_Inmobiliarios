import { describe, it, expect } from 'vitest'
import {
  aNumero, aFecha, aBooleano, parseBool, sinTildes,
  normalizaEncabezado, columnaDeEncabezado, validarLote,
  PRODUCTOS_CONFIG, PROVEEDORES_CONFIG, PERSONAS_CONFIG,
  type FilaParseada,
} from '@/lib/import/config'
import {
  detectarSeparador, partirLinea, partirLineas, mapearEncabezados, parsearCSV,
} from '@/lib/import/csv'

describe('aNumero', () => {
  it('lee los precios colombianos con separador de miles', () => {
    // El error que hacía entrar un jabón de $18.900 como $18,90.
    expect(aNumero('18.900')).toBe(18900)
    expect(aNumero('$ 18.900')).toBe(18900)
    expect(aNumero('1.234.567')).toBe(1234567)
    expect(aNumero('COP 2.500')).toBe(2500)
  })

  it('lee los decimales escritos con coma', () => {
    expect(aNumero('18,5')).toBe(18.5)
    expect(aNumero('0,75')).toBe(0.75)
    expect(aNumero('$ 18.900,50')).toBe(18900.5)
  })

  it('también entiende el formato inglés', () => {
    expect(aNumero('1,234,567')).toBe(1234567)
    expect(aNumero('1,234.56')).toBe(1234.56)
  })

  it('un punto que no agrupa miles sigue siendo decimal', () => {
    expect(aNumero('18.5')).toBe(18.5)
    expect(aNumero('0.75')).toBe(0.75)
    expect(aNumero('1.25')).toBe(1.25)
  })

  it('respeta los números que Excel ya entrega como número', () => {
    expect(aNumero(18900)).toBe(18900)
    expect(aNumero(0)).toBe(0)
    expect(aNumero(-3.5)).toBe(-3.5)
  })

  it('lee negativos, con signo o entre paréntesis', () => {
    expect(aNumero('-1.500')).toBe(-1500)
    expect(aNumero('(1.500)')).toBe(-1500)
  })

  it('ignora espacios, incluido el espacio duro que pega Excel', () => {
    expect(aNumero('  1 500  ')).toBe(1500)
    expect(aNumero('18 900')).toBe(18900)
  })

  it('devuelve null cuando no es un número (antes entraba como 0)', () => {
    for (const v of ['no aplica', 'N/A', '', '   ', 'doce', '12abc', 'a.b.c', null, undefined, true]) {
      expect(aNumero(v), String(v)).toBeNull()
    }
  })

  it('no acepta una fecha como número', () => {
    expect(aNumero(new Date('2026-01-15'))).toBeNull()
  })
})

describe('aFecha', () => {
  it('acepta el formato ISO', () => {
    expect(aFecha('2026-01-15')).toBe('2026-01-15')
    expect(aFecha('2026-1-5')).toBe('2026-01-05')
  })

  it('acepta el formato colombiano DD/MM/AAAA', () => {
    expect(aFecha('15/01/2026')).toBe('2026-01-15')
    expect(aFecha('5-1-2026')).toBe('2026-01-05')
    expect(aFecha('15.01.2026')).toBe('2026-01-15')
  })

  it('acepta el Date que entrega Excel', () => {
    expect(aFecha(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01-15')
  })

  it('acepta el número de serie de Excel', () => {
    // Excel cuenta los días desde el 30/12/1899.
    expect(aFecha(45000)).toBe('2023-03-15')
    expect(aFecha(1)).toBe('1899-12-31')
  })

  it('acepta una marca de tiempo completa', () => {
    expect(aFecha('2026-01-15T10:30:00Z')).toBe('2026-01-15')
  })

  it('rechaza fechas que no existen', () => {
    expect(aFecha('31/02/2026')).toBeNull()
    expect(aFecha('2026-13-01')).toBeNull()
    expect(aFecha('2026-02-30')).toBeNull()
  })

  it('rechaza lo que no es una fecha', () => {
    for (const v of ['', '   ', 'ayer', '15/01', '2026', null, undefined]) {
      expect(aFecha(v), String(v)).toBeNull()
    }
  })
})

describe('aBooleano', () => {
  it('reconoce las formas afirmativas', () => {
    for (const v of ['SI', 'si', 'Sí', 'SÍ', 'true', '1', 'x', 'X', 'yes', ' si ', true]) {
      expect(aBooleano(v), String(v)).toBe(true)
    }
  })

  it('reconoce las formas negativas', () => {
    for (const v of ['NO', 'no', 'false', 'falso', '0', 'n', false]) {
      expect(aBooleano(v), String(v)).toBe(false)
    }
  })

  it('devuelve null cuando no reconoce el texto (para poder avisar)', () => {
    for (const v of ['tal vez', 'quizá', '', null, undefined]) {
      expect(aBooleano(v), String(v)).toBeNull()
    }
  })

  it('parseBool sigue siendo tolerante: lo desconocido es "no"', () => {
    expect(parseBool('tal vez')).toBe(false)
    expect(parseBool('SI')).toBe(true)
    expect(parseBool(null)).toBe(false)
  })
})

describe('encabezados', () => {
  it('sinTildes quita los acentos', () => {
    expect(sinTildes('Presentación')).toBe('Presentacion')
    expect(sinTildes('TELÉFONO')).toBe('TELEFONO')
  })

  it('normaliza mayúsculas, tildes, espacios y guiones', () => {
    for (const h of ['precio_lista', 'Precio Lista', 'PRECIO-LISTA', '  precio   lista  ', 'Precio.Lista']) {
      expect(normalizaEncabezado(h), h).toBe('precio_lista')
    }
  })

  it('empareja la columna por su clave, su etiqueta o un alias', () => {
    expect(columnaDeEncabezado(PRODUCTOS_CONFIG, 'precio_lista')?.key).toBe('precio_lista')
    expect(columnaDeEncabezado(PRODUCTOS_CONFIG, 'Precio')?.key).toBe('precio_lista')
    expect(columnaDeEncabezado(PRODUCTOS_CONFIG, 'NOMBRE')?.key).toBe('nombre_estandar')
    expect(columnaDeEncabezado(PRODUCTOS_CONFIG, 'Descripción')?.key).toBe('nombre_estandar')
  })

  it('devuelve null para un encabezado que no corresponde a nada', () => {
    expect(columnaDeEncabezado(PRODUCTOS_CONFIG, 'columna_rara')).toBeNull()
    expect(columnaDeEncabezado(PRODUCTOS_CONFIG, '')).toBeNull()
  })

  it('mapearEncabezados avisa qué se reconoció, qué sobra y qué falta', () => {
    const m = mapearEncabezados(PRODUCTOS_CONFIG, ['Nombre', 'Precio', 'Vendedor'])
    expect(m.porIndice).toEqual(['nombre_estandar', 'precio_lista', null])
    expect(m.reconocidas).toEqual(['nombre_estandar', 'precio_lista'])
    expect(m.desconocidas).toEqual(['Vendedor'])
    expect(m.faltantes).toEqual([])
  })

  it('reporta las columnas obligatorias que no vienen en el archivo', () => {
    const m = mapearEncabezados(PRODUCTOS_CONFIG, ['ref', 'precio'])
    expect(m.faltantes).toEqual(['nombre_estandar'])
  })

  it('una columna repetida en el archivo se toma una sola vez', () => {
    const m = mapearEncabezados(PRODUCTOS_CONFIG, ['nombre', 'nombre_estandar'])
    expect(m.porIndice).toEqual(['nombre_estandar', null])
  })
})

describe('CSV', () => {
  it('detecta el separador que usa Excel en español', () => {
    expect(detectarSeparador('nombre;precio;ref')).toBe(';')
    expect(detectarSeparador('nombre,precio,ref')).toBe(',')
    expect(detectarSeparador('nombre\tprecio\tref')).toBe('\t')
  })

  it('respeta las comillas al partir una línea', () => {
    expect(partirLinea('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
    expect(partirLinea('a,"di ""hola""",c', ',')).toEqual(['a', 'di "hola"', 'c'])
  })

  it('un salto de línea dentro de comillas no parte el registro', () => {
    expect(partirLineas('a,b\n"linea\ncon salto",c')).toHaveLength(2)
  })

  it('descarta el BOM y las líneas en blanco', () => {
    expect(partirLineas('﻿a,b\n\n\nc,d')).toEqual(['a,b', 'c,d'])
  })

  it('lee un CSV separado por punto y coma (el que sale de Excel es-CO)', () => {
    const csv = 'nombre_estandar;precio_lista;tipo_insumo\nJABON;18.900;ASEO\nESCOBA;12.500;ASEO'
    const r = parsearCSV(csv, PRODUCTOS_CONFIG)

    expect(r.filas).toHaveLength(2)
    expect(r.filas[0]).toMatchObject({ _fila: 2, nombre_estandar: 'JABON', precio_lista: '18.900' })
    expect(r.desconocidas).toEqual([])
  })

  it('numera las filas como las ve el usuario en Excel', () => {
    const csv = 'nombre_estandar\nA\nB'
    expect(parsearCSV(csv, PRODUCTOS_CONFIG).filas.map(f => f._fila)).toEqual([2, 3])
  })

  it('un CSV sin filas de datos no revienta', () => {
    expect(parsearCSV('nombre_estandar', PRODUCTOS_CONFIG).filas).toEqual([])
    expect(parsearCSV('', PRODUCTOS_CONFIG).filas).toEqual([])
  })
})

describe('validarLote', () => {
  const fila = (n: number, datos: Record<string, unknown>): FilaParseada => ({ _fila: n, ...datos })

  it('marca como repetida la segunda aparición de la misma clave', () => {
    const r = validarLote(PRODUCTOS_CONFIG, [
      fila(2, { ref: 1001, nombre_estandar: 'JABON' }),
      fila(3, { ref: 1001, nombre_estandar: 'JABON (otra vez)' }),
      fila(4, { ref: 1002, nombre_estandar: 'ESCOBA' }),
    ], new Set())

    expect(r.filas.map(f => f.estado)).toEqual(['nuevo', 'duplicado', 'nuevo'])
    expect(r.filas[1].avisos[0]).toContain('fila 2')
    expect(r.resumen).toMatchObject({ nuevo: 2, duplicado: 1 })
  })

  it('compara los repetidos sin distinguir mayúsculas ni espacios', () => {
    const r = validarLote(PROVEEDORES_CONFIG, [
      fila(2, { nombre: 'Detalgraf S.A.S' }),
      fila(3, { nombre: '  DETALGRAF S.A.S  ' }),
    ], new Set())
    expect(r.filas[1].estado).toBe('duplicado')
  })

  it('omite la fila de ejemplo si se olvidaron de borrarla', () => {
    const ejemplo = Object.fromEntries(PRODUCTOS_CONFIG.columns.map(c => [c.key, c.ejemplo]))
    const r = validarLote(PRODUCTOS_CONFIG, [
      fila(2, ejemplo),
      fila(3, { nombre_estandar: 'PRODUCTO REAL' }),
    ], new Set())

    expect(r.filas[0].estado).toBe('omitido')
    expect(r.filas[0].datos).toEqual({})
    expect(r.filas[1].estado).toBe('nuevo')
  })

  it('una fila con error no bloquea a las demás ni cuenta como repetida', () => {
    const r = validarLote(PRODUCTOS_CONFIG, [
      fila(2, { ref: 1001 }),                                  // falta el nombre
      fila(3, { ref: 1001, nombre_estandar: 'JABON' }),
    ], new Set())

    expect(r.filas[0].estado).toBe('error')
    expect(r.filas[1].estado).toBe('nuevo')
  })

  it('distingue lo que ya existe en la base de lo nuevo', () => {
    const r = validarLote(PRODUCTOS_CONFIG, [
      fila(2, { ref: 1001, nombre_estandar: 'JABON' }),
      fila(3, { ref: 9999, nombre_estandar: 'NUEVO' }),
    ], new Set(['ref:1001']))

    expect(r.filas.map(f => f.estado)).toEqual(['actualizar', 'nuevo'])
  })

  it('el resumen suma exactamente el total de filas', () => {
    const r = validarLote(PERSONAS_CONFIG, [
      fila(2, { documento: '111', nombres: 'Ana', apellidos: 'Ruiz' }),
      fila(3, { documento: '111', nombres: 'Ana', apellidos: 'Ruiz' }),
      fila(4, { documento: '222' }),
    ], new Set())

    const total = Object.values(r.resumen).reduce((a, b) => a + b, 0)
    expect(total).toBe(3)
    expect(r.filas).toHaveLength(3)
  })

  it('avisa cuando una fila no trae ninguna clave para identificarla', () => {
    const r = validarLote(EMPRESAS_SIN_CLAVE, [fila(2, { ciudad: 'Bogotá' })], new Set())
    expect(r.filas[0].avisos.join(' ')).toContain('Sin clave')
  })
})

// Config mínima para el caso "fila sin clave": ninguna columna obligatoria.
const EMPRESAS_SIN_CLAVE = {
  ...PRODUCTOS_CONFIG,
  columns: [{ key: 'ciudad', label: 'ciudad', type: 'text' as const, ejemplo: 'Bogotá' }],
  matchKeys: ['ref'],
}

describe('fechas dentro de la validación de filas', () => {
  it('la fecha de ingreso se normaliza a AAAA-MM-DD', () => {
    const r = validarLote(PERSONAS_CONFIG, [{
      _fila: 2, documento: '111', nombres: 'Ana', apellidos: 'Ruiz', fecha_ingreso: '15/01/2026',
    }], new Set())
    expect(r.filas[0].datos.fecha_ingreso).toBe('2026-01-15')
  })

  it('una fecha imposible se reporta en el preview, no se pierde en silencio', () => {
    const r = validarLote(PERSONAS_CONFIG, [{
      _fila: 2, documento: '111', nombres: 'Ana', apellidos: 'Ruiz', fecha_ingreso: '31/02/2026',
    }], new Set())
    expect(r.filas[0].estado).toBe('error')
    expect(r.filas[0].errores[0]).toContain('fecha_ingreso')
  })

  it('acepta el Date que llega desde Excel', () => {
    const r = validarLote(PERSONAS_CONFIG, [{
      _fila: 2, documento: '111', nombres: 'Ana', apellidos: 'Ruiz',
      fecha_ingreso: new Date(Date.UTC(2026, 0, 15)),
    }], new Set())
    expect(r.filas[0].datos.fecha_ingreso).toBe('2026-01-15')
  })
})

describe('booleanos dentro de la validación de filas', () => {
  it('SI / NO se guardan como booleano', () => {
    const si = validarLote(PROVEEDORES_CONFIG, [{ _fila: 2, nombre: 'A', es_principal: 'SI' }], new Set())
    const no = validarLote(PROVEEDORES_CONFIG, [{ _fila: 2, nombre: 'B', es_principal: 'NO' }], new Set())
    expect(si.filas[0].datos.es_principal).toBe(true)
    expect(no.filas[0].datos.es_principal).toBe(false)
  })

  it('un valor que no es SI ni NO se reporta como error', () => {
    const r = validarLote(PROVEEDORES_CONFIG, [{ _fila: 2, nombre: 'A', es_principal: 'tal vez' }], new Set())
    expect(r.filas[0].estado).toBe('error')
    expect(r.filas[0].errores[0]).toContain('es_principal')
  })
})
