import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { construirPlantilla, parsearArchivo } from '@/lib/import/xlsx-client'
import { IMPORT_CONFIGS, PERSONAS_CONFIG, PRODUCTOS_CONFIG, validarLote, type EntityConfig } from '@/lib/import/config'

const comoArchivo = (buf: ArrayBuffer, nombre = 'archivo.xlsx') => new File([buf], nombre)

describe('plantilla → archivo → lectura (ida y vuelta)', () => {
  it.each(Object.keys(IMPORT_CONFIGS))('la plantilla de %s se genera sin fallar', async (id) => {
    // Cubre también las listas desplegables y las validaciones de Excel, que se
    // configuran con una API de ExcelJS que TypeScript no verifica.
    const buf = await construirPlantilla(IMPORT_CONFIGS[id])
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it.each(Object.keys(IMPORT_CONFIGS))('la plantilla de %s se vuelve a leer completa', async (id) => {
    const config = IMPORT_CONFIGS[id] as EntityConfig
    const archivo = await parsearArchivo(comoArchivo(await construirPlantilla(config)), config)

    expect(archivo.faltantes, 'faltan columnas obligatorias').toEqual([])
    expect(archivo.desconocidas, 'hay encabezados que la app no reconoce').toEqual([])
    expect(archivo.reconocidas).toHaveLength(config.columns.length)
  })

  it('la fila de ejemplo de la plantilla se detecta y se omite', async () => {
    const archivo = await parsearArchivo(comoArchivo(await construirPlantilla(PRODUCTOS_CONFIG)), PRODUCTOS_CONFIG)
    const lote = validarLote(PRODUCTOS_CONFIG, archivo.filas, new Set())

    expect(archivo.filas).toHaveLength(1)
    expect(lote.filas[0].estado).toBe('omitido')
    expect(lote.resumen.nuevo).toBe(0)
  })

  it('la plantilla trae la hoja de instrucciones', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await construirPlantilla(PRODUCTOS_CONFIG))
    expect(wb.worksheets.map(w => w.name)).toEqual(['Datos', 'Instrucciones'])
  })
})

describe('lectura de archivos de Excel reales', () => {
  /** Arma un .xlsx con los encabezados y filas dados. */
  async function libro(encabezados: string[], filas: unknown[][]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Datos')
    ws.addRow(encabezados)
    filas.forEach(f => ws.addRow(f))
    return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
  }

  it('acepta encabezados con tildes, mayúsculas y espacios', async () => {
    const buf = await libro(['Nombre', 'Presentación', 'Precio Lista'], [['JABON', 'GALON', 18900]])
    const archivo = await parsearArchivo(comoArchivo(buf), PRODUCTOS_CONFIG)

    expect(archivo.desconocidas).toEqual([])
    expect(archivo.filas[0]).toMatchObject({
      nombre_estandar: 'JABON', presentacion: 'GALON', precio_lista: 18900,
    })
  })

  it('avisa de las columnas obligatorias que no vienen y de las que sobran', async () => {
    const buf = await libro(['ref', 'Vendedor asignado'], [[1001, 'Juan']])
    const archivo = await parsearArchivo(comoArchivo(buf), PRODUCTOS_CONFIG)

    expect(archivo.faltantes).toEqual(['nombre_estandar'])
    expect(archivo.desconocidas).toEqual(['Vendedor asignado'])
  })

  it('lee las fechas como fechas, no como texto de calendario', async () => {
    const buf = await libro(
      ['documento', 'nombres', 'apellidos', 'fecha_ingreso'],
      [['1020304050', 'Ana', 'Ruiz', new Date(Date.UTC(2026, 0, 15))]],
    )
    const archivo = await parsearArchivo(comoArchivo(buf), PERSONAS_CONFIG)
    const lote = validarLote(PERSONAS_CONFIG, archivo.filas, new Set())

    expect(lote.filas[0].estado).toBe('nuevo')
    expect(lote.filas[0].datos.fecha_ingreso).toBe('2026-01-15')
  })

  it('no se traga las filas totalmente vacías del final del archivo', async () => {
    const buf = await libro(['nombre_estandar'], [['JABON'], [null], ['ESCOBA']])
    const archivo = await parsearArchivo(comoArchivo(buf), PRODUCTOS_CONFIG)

    expect(archivo.filas.map(f => f.nombre_estandar)).toEqual(['JABON', 'ESCOBA'])
  })

  it('numera las filas igual que Excel, para poder corregir el archivo', async () => {
    const buf = await libro(['nombre_estandar'], [['A'], ['B'], ['C']])
    const archivo = await parsearArchivo(comoArchivo(buf), PRODUCTOS_CONFIG)

    expect(archivo.filas.map(f => f._fila)).toEqual([2, 3, 4])
  })

  it('un precio escrito como texto en Excel también entra bien', async () => {
    const buf = await libro(['nombre_estandar', 'precio_lista'], [['JABON', '$ 18.900']])
    const archivo = await parsearArchivo(comoArchivo(buf), PRODUCTOS_CONFIG)
    const lote = validarLote(PRODUCTOS_CONFIG, archivo.filas, new Set())

    expect(lote.filas[0].errores).toEqual([])
    expect(lote.filas[0].datos.precio_lista).toBe(18900)
  })

  it('un archivo .csv se reconoce por la extensión', async () => {
    const csv = new File(['nombre_estandar;precio_lista\nJABON;18.900'], 'datos.csv')
    const archivo = await parsearArchivo(csv, PRODUCTOS_CONFIG)

    expect(archivo.filas).toHaveLength(1)
    expect(archivo.filas[0].nombre_estandar).toBe('JABON')
  })
})
