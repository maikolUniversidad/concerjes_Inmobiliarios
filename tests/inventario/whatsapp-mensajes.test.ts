// Los límites de WhatsApp, metidos en el armador de mensajes.
//
// POR QUÉ IMPORTA: si un mensaje que no cabe se encola igual, Meta devuelve un
// error en producción y el conserje se queda esperando una respuesta que nunca
// llega, parado en un punto, de noche. Mejor que falle acá.
//
// Y por eso el SIMULADOR respeta los mismos límites: un simulador más permisivo
// que la realidad no prueba nada.

import { describe, expect, it } from 'vitest'
import {
  aPayloadMeta, describir, ErrorLimite, LIMITES, listaPaginada, partir, recortar, validar,
  type MensajeSaliente,
} from '@/lib/whatsapp/mensajes'

const texto = (n: number) => 'x'.repeat(n)
const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, titulo: `Fila ${i}` }))

describe('texto', () => {
  it('acepta hasta 4.096 caracteres', () => {
    expect(() => validar({ tipo: 'TEXTO', texto: texto(LIMITES.textoCuerpo) })).not.toThrow()
  })
  it('rechaza más de 4.096', () => {
    expect(() => validar({ tipo: 'TEXTO', texto: texto(LIMITES.textoCuerpo + 1) })).toThrow(ErrorLimite)
  })
  it('rechaza un texto vacío', () => {
    expect(() => validar({ tipo: 'TEXTO', texto: '' })).toThrow(ErrorLimite)
  })
  it('cuenta un emoji como UN carácter, no como dos', () => {
    // Los textos del bot llevan emoji. 🧯 está fuera del BMP, así que en UTF-16
    // ocupa DOS unidades: contando con `.length`, un mensaje lleno de emoji se
    // rechazaría a la mitad del tope real.
    const conEmoji = '🧯'.repeat(LIMITES.textoCuerpo)
    expect(conEmoji.length).toBe(LIMITES.textoCuerpo * 2)
    expect([...conEmoji]).toHaveLength(LIMITES.textoCuerpo)
    expect(() => validar({ tipo: 'TEXTO', texto: conEmoji })).not.toThrow()
    expect(() => validar({ tipo: 'TEXTO', texto: conEmoji + '🧯' })).toThrow(ErrorLimite)
  })
})

describe('botones', () => {
  const b = (n: number): MensajeSaliente => ({
    tipo: 'BOTONES',
    cuerpo: 'hola',
    botones: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, texto: `Opción ${i}` })),
  })

  it('acepta de 1 a 3', () => {
    for (const n of [1, 2, 3]) expect(() => validar(b(n)), `${n} botones`).not.toThrow()
  })
  it('rechaza 0 y rechaza 4', () => {
    expect(() => validar(b(0))).toThrow(ErrorLimite)
    expect(() => validar(b(4))).toThrow(ErrorLimite)
  })
  it('rechaza un título de más de 20 caracteres', () => {
    expect(() => validar({ tipo: 'BOTONES', cuerpo: 'x', botones: [{ id: 'b', texto: texto(21) }] })).toThrow(ErrorLimite)
  })
  it('rechaza ids repetidos', () => {
    // Dos botones con el mismo id hacen que la respuesta sea ambigua: el bot no
    // sabría cuál tocó la persona.
    expect(() => validar({
      tipo: 'BOTONES', cuerpo: 'x',
      botones: [{ id: 'mismo', texto: 'A' }, { id: 'mismo', texto: 'B' }],
    })).toThrow(ErrorLimite)
  })
  it('rechaza un cuerpo de más de 1.024 en un interactivo', () => {
    // El tope de un interactivo es más bajo que el de un texto suelto.
    expect(() => validar({ tipo: 'BOTONES', cuerpo: texto(1025), botones: [{ id: 'b', texto: 'A' }] })).toThrow(ErrorLimite)
  })
  it('rechaza un encabezado o un pie de más de 60', () => {
    const base = { tipo: 'BOTONES' as const, cuerpo: 'x', botones: [{ id: 'b', texto: 'A' }] }
    expect(() => validar({ ...base, encabezado: texto(61) })).toThrow(ErrorLimite)
    expect(() => validar({ ...base, pie: texto(61) })).toThrow(ErrorLimite)
  })
})

describe('lista', () => {
  const l = (secciones: { titulo?: string; filas: { id: string; titulo: string; descripcion?: string }[] }[]): MensajeSaliente => ({
    tipo: 'LISTA', cuerpo: 'elegí', botonTexto: 'Ver', secciones,
  })

  it('acepta 10 filas EN TOTAL', () => {
    expect(() => validar(l([{ filas: filas(10) }]))).not.toThrow()
  })

  it('rechaza 11 filas aunque estén en varias secciones', () => {
    // ES EL LÍMITE QUE MÁS SE CONFUNDE: 10 secciones Y 10 filas en total, no 10
    // por sección. Una lista de 3 secciones con 4 filas cada una no cabe.
    expect(() => validar(l([{ filas: filas(6) }, { filas: filas(5) }]))).toThrow(ErrorLimite)
    expect(() => validar(l([{ filas: filas(4) }, { filas: filas(4) }, { filas: filas(4) }]))).toThrow(ErrorLimite)
  })

  it('rechaza más de 10 secciones', () => {
    expect(() => validar(l(Array.from({ length: 11 }, () => ({ filas: [{ id: 'x', titulo: 'y' }] }))))).toThrow(ErrorLimite)
  })

  it('rechaza una lista sin filas', () => {
    expect(() => validar(l([{ filas: [] }]))).toThrow(ErrorLimite)
  })

  it('rechaza un título de fila de más de 24 y una descripción de más de 72', () => {
    expect(() => validar(l([{ filas: [{ id: 'a', titulo: texto(25) }] }]))).toThrow(ErrorLimite)
    expect(() => validar(l([{ filas: [{ id: 'a', titulo: 'ok', descripcion: texto(73) }] }]))).toThrow(ErrorLimite)
  })

  it('rechaza el texto del botón de más de 20', () => {
    expect(() => validar({ tipo: 'LISTA', cuerpo: 'x', botonTexto: texto(21), secciones: [{ filas: filas(1) }] })).toThrow(ErrorLimite)
  })

  it('rechaza un id de fila de más de 200', () => {
    expect(() => validar(l([{ filas: [{ id: texto(201), titulo: 'ok' }] }]))).toThrow(ErrorLimite)
  })

  it('rechaza ids de fila repetidos entre secciones distintas', () => {
    expect(() => validar(l([
      { filas: [{ id: 'mismo', titulo: 'A' }] },
      { filas: [{ id: 'mismo', titulo: 'B' }] },
    ]))).toThrow(ErrorLimite)
  })

  it('el mensaje de error dice el campo y la medida', () => {
    try {
      validar(l([{ filas: filas(11) }]))
      expect.unreachable('tenía que fallar')
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorLimite)
      expect((e as ErrorLimite).campo).toBe('filas')
      expect((e as Error).message).toContain('11')
    }
  })
})

describe('listaPaginada', () => {
  it('deja 9 filas y agrega «Ver más» cuando hay de sobra', () => {
    const r = listaPaginada(filas(20), 1, (n) => `pag:${n}`)
    expect(r.filas).toHaveLength(10)
    expect(r.hayMas).toBe(true)
    expect(r.filas[9].id).toBe('pag:2')
  })

  it('la página con lo justo no agrega «Ver más»', () => {
    const r = listaPaginada(filas(9), 1, (n) => `pag:${n}`)
    expect(r.filas).toHaveLength(9)
    expect(r.hayMas).toBe(false)
  })

  it('lo que pagina sigue cabiendo en una lista de WhatsApp', () => {
    for (const total of [1, 9, 10, 11, 25, 100]) {
      for (let p = 1; p <= 4; p++) {
        const r = listaPaginada(filas(total), p, (n) => `pag:${n}`)
        if (!r.filas.length) continue
        expect(
          () => validar({ tipo: 'LISTA', cuerpo: 'x', botonTexto: 'Ver', secciones: [{ filas: r.filas }] }),
          `total ${total}, página ${p}`,
        ).not.toThrow()
      }
    }
  })

  it('la última página no repite ni pierde filas', () => {
    const todas = filas(23)
    const vistas: string[] = []
    for (let p = 1; p <= 3; p++) {
      for (const f of listaPaginada(todas, p, (n) => `pag:${n}`).filas) {
        if (!f.id.startsWith('pag:')) vistas.push(f.id)
      }
    }
    expect(new Set(vistas).size).toBe(vistas.length)
    expect(vistas).toHaveLength(23)
  })
})

describe('recortar y partir', () => {
  it('recortar deja el tope exacto, con puntos suspensivos', () => {
    const r = recortar(texto(100), 20)
    expect([...r]).toHaveLength(20)
    expect(r.endsWith('…')).toBe(true)
  })
  it('recortar no toca lo que ya cabe', () => {
    expect(recortar('corto', 20)).toBe('corto')
  })
  it('partir devuelve trozos que todos caben', () => {
    const largo = Array.from({ length: 300 }, (_, i) => `Paso ${i}: abrir y revisar el sello.`).join('\n')
    const partes = partir(largo, 500)
    expect(partes.length).toBeGreaterThan(1)
    for (const p of partes) expect([...p].length).toBeLessThanOrEqual(500)
    // Y no se pierde contenido: partir no es recortar.
    expect(partes.join('\n').replace(/\n/g, '')).toBe(largo.replace(/\n/g, ''))
  })
  it('partir no rompe un emoji por la mitad', () => {
    const partes = partir('🧯'.repeat(50), 10)
    for (const p of partes) expect(p).not.toContain('�')
    expect(partes.join('')).toBe('🧯'.repeat(50))
  })
})

describe('aPayloadMeta', () => {
  it('un texto sale con la forma que espera la Cloud API', () => {
    expect(aPayloadMeta('573000000091', { tipo: 'TEXTO', texto: 'hola' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '573000000091',
      type: 'text',
      text: { body: 'hola', preview_url: false },
    })
  })

  it('los botones salen como interactive/button con reply', () => {
    const p = aPayloadMeta('573000000091', {
      tipo: 'BOTONES', cuerpo: '¿Confirmás?',
      botones: [{ id: 'resumen:confirmar', texto: 'Confirmar' }, { id: 'resumen:corregir', texto: 'Corregir' }],
    }) as Record<string, any>
    expect(p.type).toBe('interactive')
    expect(p.interactive.type).toBe('button')
    expect(p.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'resumen:confirmar', title: 'Confirmar' } },
      { type: 'reply', reply: { id: 'resumen:corregir', title: 'Corregir' } },
    ])
  })

  it('la solicitud de ubicación usa location_request_message con send_location', () => {
    const p = aPayloadMeta('573000000091', { tipo: 'SOLICITUD_UBICACION', cuerpo: 'Tocá enviar ubicación' }) as Record<string, any>
    expect(p.interactive.type).toBe('location_request_message')
    expect(p.interactive.action).toEqual({ name: 'send_location' })
  })

  it('una plantilla lleva su idioma y sus variables en orden', () => {
    const p = aPayloadMeta('573000000091', {
      tipo: 'PLANTILLA', nombre: 'visita_pendiente_cierre', idioma: 'es_CO',
      variables: ['Ana', 'K7M-4QX9', 'Portería principal', '18 de octubre'],
    }) as Record<string, any>
    expect(p.template.name).toBe('visita_pendiente_cierre')
    expect(p.template.language).toEqual({ code: 'es_CO' })
    expect(p.template.components[0].parameters.map((x: any) => x.text)).toEqual([
      'Ana', 'K7M-4QX9', 'Portería principal', '18 de octubre',
    ])
  })

  it('VALIDA antes de armar: un mensaje que no cabe no llega a tener payload', () => {
    expect(() => aPayloadMeta('57300', { tipo: 'TEXTO', texto: texto(5000) })).toThrow(ErrorLimite)
    expect(() => aPayloadMeta('57300', {
      tipo: 'LISTA', cuerpo: 'x', botonTexto: 'Ver', secciones: [{ filas: filas(11) }],
    })).toThrow(ErrorLimite)
  })

  it('no mete claves vacías cuando no hay encabezado ni pie', () => {
    const p = aPayloadMeta('57300', { tipo: 'BOTONES', cuerpo: 'x', botones: [{ id: 'a', texto: 'A' }] }) as Record<string, any>
    expect('header' in p.interactive).toBe(false)
    expect('footer' in p.interactive).toBe(false)
  })
})

describe('describir', () => {
  it('resume cada tipo en una línea legible', () => {
    expect(describir({ tipo: 'TEXTO', texto: 'hola' })).toBe('hola')
    expect(describir({ tipo: 'BOTONES', cuerpo: '¿Sí?', botones: [{ id: 'a', texto: 'Sí' }] })).toContain('Sí')
    expect(describir({ tipo: 'SOLICITUD_UBICACION', cuerpo: 'ubicación' })).toContain('Enviar ubicación')
    expect(describir({ tipo: 'PLANTILLA', nombre: 'x', idioma: 'es_CO', variables: ['Ana'] })).toContain('Ana')
  })
})
