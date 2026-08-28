import { describe, it, expect } from 'vitest'
import { extDe, sha256, tipoAplica, MAX_BYTES } from '@/lib/registro/documentos'
import type { TipoDocumental } from '@/lib/registro/tipos'

const tipo = (extra: Partial<TipoDocumental> = {}): TipoDocumental => ({
  id: 't1', codigo: 'CEDULA', nombre: 'Cédula', grupo: 'Identidad',
  obligatorio: true, min_archivos: 1, max_archivos: 2,
  formatos_permitidos: ['jpg', 'png', 'pdf'], vigencia_dias: null,
  requiere_ocr: false, aplica_si: null, ola: 1, orden: 1,
  ...extra,
})

describe('MAX_BYTES', () => {
  it('el tope de subida son 8 MB', () => {
    expect(MAX_BYTES).toBe(8 * 1024 * 1024)
  })
})

describe('extDe', () => {
  it('toma la extensión del nombre del archivo', () => {
    expect(extDe(new File([''], 'cedula.PDF', { type: 'application/pdf' }))).toBe('pdf')
    expect(extDe(new File([''], 'foto.jpeg', { type: 'image/jpeg' }))).toBe('jpeg')
  })

  it('usa la última extensión cuando el nombre trae varios puntos', () => {
    expect(extDe(new File([''], 'mi.cedula.frente.jpg', { type: 'image/jpeg' }))).toBe('jpg')
  })

  it('si no hay extensión usable cae al tipo MIME', () => {
    expect(extDe(new File([''], 'documento', { type: 'application/pdf' }))).toBe('pdf')
    expect(extDe(new File([''], 'documento', { type: 'image/jpeg' }))).toBe('jpg')
  })

  it('descarta extensiones absurdamente largas', () => {
    expect(extDe(new File([''], 'archivo.documento', { type: 'application/pdf' }))).toBe('pdf')
  })
})

describe('sha256', () => {
  it('devuelve 64 caracteres hexadecimales', async () => {
    const h = await sha256(new File(['hola'], 'a.txt'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('el mismo contenido siempre da el mismo hash (detecta duplicados)', async () => {
    const a = await sha256(new File(['hola'], 'a.txt'))
    const b = await sha256(new File(['hola'], 'otro-nombre.txt'))
    expect(a).toBe(b)
  })

  it('contenidos distintos dan hashes distintos', async () => {
    const a = await sha256(new File(['hola'], 'a.txt'))
    const b = await sha256(new File(['hola '], 'a.txt'))
    expect(a).not.toBe(b)
  })
})

describe('tipoAplica', () => {
  it('sin regla condicional, el documento siempre aplica', () => {
    expect(tipoAplica(tipo(), null)).toBe(true)
    expect(tipoAplica(tipo(), { requiere_trabajo_alturas: true })).toBe(true)
  })

  it('aplica cuando el cargo cumple la condición', () => {
    const t = tipo({ aplica_si: { 'cargo.requiere_trabajo_alturas': true } })
    expect(tipoAplica(t, { requiere_trabajo_alturas: true })).toBe(true)
  })

  it('no aplica cuando el cargo no cumple, o no se conocen sus banderas', () => {
    const t = tipo({ aplica_si: { 'cargo.requiere_trabajo_alturas': true } })
    expect(tipoAplica(t, { requiere_trabajo_alturas: false })).toBe(false)
    expect(tipoAplica(t, {})).toBe(false)
    expect(tipoAplica(t, null)).toBe(false)
  })

  it('una condición negativa aplica cuando el cargo NO tiene la bandera', () => {
    const t = tipo({ aplica_si: { 'cargo.requiere_libreta_militar': false } })
    expect(tipoAplica(t, {})).toBe(true)
    expect(tipoAplica(t, { requiere_libreta_militar: true })).toBe(false)
  })

  it('exige que se cumplan TODAS las condiciones', () => {
    const t = tipo({
      aplica_si: {
        'cargo.requiere_trabajo_alturas': true,
        'cargo.requiere_manipulacion_alimentos': true,
      },
    })
    expect(tipoAplica(t, { requiere_trabajo_alturas: true, requiere_manipulacion_alimentos: true })).toBe(true)
    expect(tipoAplica(t, { requiere_trabajo_alturas: true })).toBe(false)
  })

  it('acepta claves sin el prefijo "cargo."', () => {
    const t = tipo({ aplica_si: { requiere_trabajo_alturas: true } })
    expect(tipoAplica(t, { requiere_trabajo_alturas: true })).toBe(true)
  })
})
