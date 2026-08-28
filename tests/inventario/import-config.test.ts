import { describe, it, expect } from 'vitest'
import {
  IMPORT_CONFIGS, PRODUCTOS_CONFIG, PERSONAS_CONFIG, USUARIOS_CONFIG,
  normalizaClave, parseBool, validarFila,
} from '@/lib/import/config'

describe('configuración de cargas masivas', () => {
  it('el id de cada configuración coincide con su llave en el mapa', () => {
    for (const [llave, cfg] of Object.entries(IMPORT_CONFIGS)) {
      expect(cfg.id, `${llave} tiene id distinto`).toBe(llave)
    }
  })

  it('las matchKeys existen como columnas de la plantilla', () => {
    for (const cfg of Object.values(IMPORT_CONFIGS)) {
      const claves = new Set(cfg.columns.map((c) => c.key))
      for (const mk of cfg.matchKeys) {
        expect(claves.has(mk), `${cfg.id}: la matchKey "${mk}" no es una columna`).toBe(true)
      }
    }
  })

  it('cada entidad tiene al menos una matchKey y una columna obligatoria', () => {
    for (const cfg of Object.values(IMPORT_CONFIGS)) {
      expect(cfg.matchKeys.length, `${cfg.id} sin matchKeys`).toBeGreaterThan(0)
      expect(cfg.columns.some((c) => c.required), `${cfg.id} sin campo obligatorio`).toBe(true)
    }
  })

  it('no hay columnas repetidas dentro de una entidad', () => {
    for (const cfg of Object.values(IMPORT_CONFIGS)) {
      const claves = cfg.columns.map((c) => c.key)
      expect(new Set(claves).size, `${cfg.id} repite columnas`).toBe(claves.length)
    }
  })

  it('toda columna enum declara sus valores y su ejemplo es uno de ellos', () => {
    for (const cfg of Object.values(IMPORT_CONFIGS)) {
      for (const col of cfg.columns.filter((c) => c.type === 'enum')) {
        expect(col.enumValues?.length, `${cfg.id}.${col.key} sin enumValues`).toBeGreaterThan(0)
        expect(col.enumValues, `${cfg.id}.${col.key}: el ejemplo no es válido`)
          .toContain(String(col.ejemplo))
      }
    }
  })

  it('el ejemplo de las columnas email tiene forma de correo', () => {
    for (const cfg of Object.values(IMPORT_CONFIGS)) {
      for (const col of cfg.columns.filter((c) => c.type === 'email')) {
        expect(String(col.ejemplo), `${cfg.id}.${col.key}`).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
      }
    }
  })

  it('la fila de ejemplo de cada plantilla pasa la validación', () => {
    for (const cfg of Object.values(IMPORT_CONFIGS)) {
      const fila = { _fila: 2, ...Object.fromEntries(cfg.columns.map((c) => [c.key, c.ejemplo])) }
      const res = validarFila(cfg, fila, new Set())
      expect(res.errores, `${cfg.id}: el ejemplo de la plantilla no valida`).toEqual([])
      expect(res.estado).toBe('nuevo')
    }
  })
})

describe('normalizaClave', () => {
  it('quita espacios y pasa a minúsculas', () => {
    expect(normalizaClave('  DETALGRAF S.A.S  ')).toBe('detalgraf s.a.s')
  })

  it('convierte null y undefined en cadena vacía', () => {
    expect(normalizaClave(null)).toBe('')
    expect(normalizaClave(undefined)).toBe('')
  })

  it('acepta números', () => {
    expect(normalizaClave(1001)).toBe('1001')
  })
})

describe('parseBool', () => {
  it('reconoce las formas afirmativas del Excel', () => {
    for (const v of ['SI', 'si', 'Sí', 'true', 'TRUE', '1', 'x', 'X', 'yes', ' si ']) {
      expect(parseBool(v), String(v)).toBe(true)
    }
  })

  it('todo lo demás es falso', () => {
    for (const v of ['NO', 'no', 'false', '0', '', null, undefined, 'tal vez']) {
      expect(parseBool(v), String(v)).toBe(false)
    }
  })
})

describe('validarFila', () => {
  const nueva = (datos: Record<string, unknown>) => ({ _fila: 2, ...datos })

  it('marca error cuando falta un campo obligatorio', () => {
    const r = validarFila(PRODUCTOS_CONFIG, nueva({ ref: 1001 }), new Set())
    expect(r.estado).toBe('error')
    expect(r.errores).toContain('Falta "nombre_estandar"')
  })

  it('marca "nuevo" cuando la clave no existe todavía', () => {
    const r = validarFila(PRODUCTOS_CONFIG, nueva({ ref: 1001, nombre_estandar: 'JABON' }), new Set())
    expect(r.estado).toBe('nuevo')
    expect(r.claveMostrada).toBe('ref=1001')
  })

  it('marca "actualizar" cuando la clave ya está en la base', () => {
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ ref: 1001, nombre_estandar: 'JABON' }),
      new Set(['ref:1001']),
    )
    expect(r.estado).toBe('actualizar')
  })

  it('recorre las matchKeys en orden hasta encontrar una que exista', () => {
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ nombre_estandar: 'JABON PARA LOZA' }),
      new Set(['nombre_estandar:jabon para loza']),
    )
    expect(r.estado).toBe('actualizar')
  })

  it('quita el símbolo de moneda y los espacios de los números', () => {
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ nombre_estandar: 'JABON', precio_lista: '$ 18900 ' }),
      new Set(),
    )
    expect(r.errores).toEqual([])
    expect(r.datos.precio_lista).toBe(18900)
  })

  it('acepta los números que Excel entrega ya como número', () => {
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ nombre_estandar: 'JABON', precio_lista: 18900, stock_inicial: 120 }),
      new Set(),
    )
    expect(r.datos.precio_lista).toBe(18900)
    expect(r.datos.stock_inicial).toBe(120)
  })

  it('un precio con separador de miles entra completo, no dividido por mil', () => {
    // Regresión: "$ 18.900" entraba como 18,9 pesos, en silencio.
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ nombre_estandar: 'JABON', precio_lista: '$ 18.900' }),
      new Set(),
    )
    expect(r.errores).toEqual([])
    expect(r.datos.precio_lista).toBe(18900)
  })

  it('un texto que no es número marca error en vez de entrar como 0', () => {
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ nombre_estandar: 'JABON', precio_lista: 'no aplica' }),
      new Set(),
    )
    expect(r.estado).toBe('error')
    expect(r.errores[0]).toContain('precio_lista')
    expect(r.datos.precio_lista).toBeUndefined()
  })

  it('rechaza cantidades negativas donde no tienen sentido', () => {
    const r = validarFila(
      PRODUCTOS_CONFIG,
      nueva({ nombre_estandar: 'JABON', stock_inicial: -5 }),
      new Set(),
    )
    expect(r.estado).toBe('error')
    expect(r.errores[0]).toContain('stock_inicial')
  })

  it('la REF debe ser un número entero', () => {
    const r = validarFila(PRODUCTOS_CONFIG, nueva({ nombre_estandar: 'X', ref: '10,5' }), new Set())
    expect(r.estado).toBe('error')
    expect(r.errores[0]).toContain('entero')
  })

  it('rechaza los enum fuera de la lista y acepta minúsculas', () => {
    const malo = validarFila(
      PRODUCTOS_CONFIG, nueva({ nombre_estandar: 'X', tipo_insumo: 'COSMETICOS' }), new Set(),
    )
    expect(malo.estado).toBe('error')
    expect(malo.errores[0]).toContain('tipo_insumo')

    const bueno = validarFila(
      PRODUCTOS_CONFIG, nueva({ nombre_estandar: 'X', tipo_insumo: 'aseo' }), new Set(),
    )
    expect(bueno.errores).toEqual([])
    expect(bueno.datos.tipo_insumo).toBe('ASEO')
  })

  it('valida el email y lo guarda en minúsculas', () => {
    const malo = validarFila(
      USUARIOS_CONFIG, nueva({ nombre: 'Ana', email: 'ana(arroba)correo.com' }), new Set(),
    )
    expect(malo.estado).toBe('error')

    const bueno = validarFila(
      USUARIOS_CONFIG, nueva({ nombre: 'Ana', email: '  Ana.Lopez@Correo.COM ' }), new Set(),
    )
    expect(bueno.errores).toEqual([])
    expect(bueno.datos.email).toBe('ana.lopez@correo.com')
  })

  it('los campos vacíos NO viajan: al actualizar no se borra lo que ya existe', () => {
    // Regresión: enviar presentacion=null pisaba la presentación guardada.
    const r = validarFila(PRODUCTOS_CONFIG, nueva({ nombre_estandar: 'X', presentacion: '   ' }), new Set())
    expect(r.errores).toEqual([])
    expect('presentacion' in r.datos).toBe(false)
    expect(Object.keys(r.datos)).toEqual(['nombre_estandar'])
  })

  it('recorta los espacios del texto', () => {
    const r = validarFila(PRODUCTOS_CONFIG, nueva({ nombre_estandar: '  JABON  ' }), new Set())
    expect(r.datos.nombre_estandar).toBe('JABON')
  })

  it('conserva el número de fila para señalar el error en pantalla', () => {
    const r = validarFila(PERSONAS_CONFIG, { _fila: 17 }, new Set())
    expect(r.fila).toBe(17)
    expect(r.claveMostrada).toBe('—')
  })

  it('acumula todos los errores de la fila, no solo el primero', () => {
    const r = validarFila(PERSONAS_CONFIG, nueva({ tipo_doc: 'XX' }), new Set())
    expect(r.errores.length).toBeGreaterThan(1)
  })
})
