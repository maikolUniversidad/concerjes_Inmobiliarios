import { describe, it, expect } from 'vitest'
import {
  EMPRESA, VERSION_CONSENTIMIENTOS, AVISO_PRIVACIDAD,
  CONSENTIMIENTO_DATOS, CONSENTIMIENTO_BIOMETRICO, hashTexto,
} from '@/lib/registro/consentimientos'

const TEXTOS = {
  AVISO_PRIVACIDAD,
  CONSENTIMIENTO_DATOS,
  CONSENTIMIENTO_BIOMETRICO,
}

describe('datos de la empresa responsable', () => {
  it('el NIT tiene el formato de la DIAN (9 dígitos + verificación)', () => {
    expect(EMPRESA.nit).toMatch(/^\d{9}-\d$/)
  })

  it('el correo de PQRS de datos es un correo válido', () => {
    expect(EMPRESA.email_pqrs).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  })

  it('no quedan campos vacíos en la ficha del responsable', () => {
    for (const [campo, valor] of Object.entries(EMPRESA)) {
      expect(valor.trim().length, `EMPRESA.${campo} está vacío`).toBeGreaterThan(0)
    }
  })
})

describe('versión de los consentimientos', () => {
  it('sigue el formato AAAA-MM-vN', () => {
    // Al cambiar cualquier texto legal hay que subir la versión: es la prueba
    // de QUÉ firmó el titular (Art. 9, Ley 1581/2012).
    expect(VERSION_CONSENTIMIENTOS).toMatch(/^\d{4}-\d{2}-v\d+$/)
  })
})

describe('textos legales', () => {
  it('ninguno queda vacío', () => {
    for (const [nombre, texto] of Object.entries(TEXTOS)) {
      expect(texto.trim().length, nombre).toBeGreaterThan(200)
    }
  })

  it('todos nombran al responsable del tratamiento', () => {
    for (const [nombre, texto] of Object.entries(TEXTOS)) {
      expect(texto, nombre).toContain(EMPRESA.razon_social)
    }
  })

  it('el aviso y la autorización de datos identifican al responsable con su NIT', () => {
    expect(AVISO_PRIVACIDAD).toContain(EMPRESA.nit)
    expect(CONSENTIMIENTO_DATOS).toContain(EMPRESA.nit)
  })

  it('el aviso de privacidad cubre finalidades, derechos, canal y conservación', () => {
    for (const exigido of [
      'Ley 1581 de 2012', 'FINALIDADES', 'DERECHOS DEL TITULAR',
      'CANAL DE RECLAMOS', 'TÉRMINO DE CONSERVACIÓN', EMPRESA.email_pqrs,
    ]) {
      expect(AVISO_PRIVACIDAD, `falta: ${exigido}`).toContain(exigido)
    }
  })

  it('el consentimiento biométrico avisa que el dato es sensible y opcional', () => {
    expect(CONSENTIMIENTO_BIOMETRICO).toContain('SENSIBLE')
    expect(CONSENTIMIENTO_BIOMETRICO).toContain('NO ESTÁ OBLIGADO')
    expect(CONSENTIMIENTO_BIOMETRICO).toContain('REVOCABLE')
  })

  it('no quedan marcadores de plantilla sin reemplazar', () => {
    for (const [nombre, texto] of Object.entries(TEXTOS)) {
      expect(texto, nombre).not.toContain('undefined')
      expect(texto, nombre).not.toMatch(/\$\{/)
      expect(texto, nombre).not.toMatch(/\[[A-Z_]+\]/)
    }
  })
})

describe('hashTexto', () => {
  it('devuelve un SHA-256 en hexadecimal', async () => {
    expect(await hashTexto('hola')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('coincide con el SHA-256 conocido de "hola"', async () => {
    expect(await hashTexto('hola'))
      .toBe('b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79')
  })

  it('es estable: el mismo texto siempre da la misma huella', async () => {
    expect(await hashTexto(AVISO_PRIVACIDAD)).toBe(await hashTexto(AVISO_PRIVACIDAD))
  })

  it('cambia si el texto cambia aunque sea un carácter', async () => {
    const a = await hashTexto(CONSENTIMIENTO_DATOS)
    const b = await hashTexto(CONSENTIMIENTO_DATOS + ' ')
    expect(a).not.toBe(b)
  })

  it('cada consentimiento tiene una huella distinta', async () => {
    const huellas = await Promise.all(Object.values(TEXTOS).map(hashTexto))
    expect(new Set(huellas).size).toBe(huellas.length)
  })
})
