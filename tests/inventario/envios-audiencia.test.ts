// La audiencia de un envío masivo (Puntos QR F10).
//
// Quien RESUELVE la audiencia es `crm_envio_resolver()` en SQL: recorre la
// nómina y escribe una fila por persona, con su motivo si queda fuera (eso se
// verifica contra la base real en `scripts/probar-puntos-qr-f10.mjs`). Lo que se
// prueba acá es la forma de lo que se le pide, que es donde un error se paga en
// mensajes mandados a quien no debía:
//
//   · El ALCANCE es explícito. Sin él, un envío que solo nombra tres personas no
//     se distingue de un envío a todo el contrato con tres personas anotadas al
//     margen. Con 6.000 personas en la nómina, esa confusión es un envío masivo
//     no deseado.
//   · El ROL es el CARGO DE LA NÓMINA y es texto libre en esta base, así que se
//     compara normalizado o no compara nada.
//   · Los MARCADORES son una lista cerrada: lo que no esté en ella sale tal cual
//     en el mensaje, y mejor avisarlo antes.

import { describe, expect, it } from 'vitest'
import {
  faltaEnAudiencia, leerResumen, marcadoresDesconocidos, normalizarAudiencia,
  normalizarCargo, variablesDeTexto, MARCADORES,
} from '@/lib/envios/audiencia'

const UNO = '11111111-1111-4111-8111-111111111111'
const DOS = '22222222-2222-4222-8222-222222222222'

describe('el alcance', () => {
  it('por defecto es todo el contrato', () => {
    expect(normalizarAudiencia({}).alcance).toBe('CONTRATO')
  })
  it('un alcance que no existe no se adivina: queda en CONTRATO', () => {
    expect(normalizarAudiencia({ alcance: 'TODOS_LOS_CELULARES' }).alcance).toBe('CONTRATO')
  })
  it('acepta los cuatro de la §4.4', () => {
    for (const a of ['CONTRATO', 'SEDES', 'PERSONAS', 'LISTA']) {
      expect(normalizarAudiencia({ alcance: a }).alcance).toBe(a)
    }
  })
})

describe('lo que cada alcance exige', () => {
  it('«sedes concretas» sin sedes se rechaza: parecería un envío a todos', () => {
    const a = normalizarAudiencia({ alcance: 'SEDES' })
    expect(faltaEnAudiencia(a)).toContain('sede')
  })
  it('«personas sueltas» sin personas válidas se rechaza', () => {
    const a = normalizarAudiencia({ alcance: 'PERSONAS', personas: ['no-es-un-uuid', ''] })
    expect(a.personas).toEqual([])
    expect(faltaEnAudiencia(a)).toContain('persona')
  })
  it('«una lista» sin código se rechaza', () => {
    expect(faltaEnAudiencia(normalizarAudiencia({ alcance: 'LISTA', lista: '  ' }))).toContain('lista')
  })
  it('todo el contrato no exige nada más', () => {
    expect(faltaEnAudiencia(normalizarAudiencia({ alcance: 'CONTRATO' }))).toBeNull()
  })
  it('con las sedes puestas, pasa', () => {
    expect(faltaEnAudiencia(normalizarAudiencia({ alcance: 'SEDES', sedes: [UNO] }))).toBeNull()
  })
})

describe('las personas sueltas', () => {
  it('solo entran identificadores con forma de uuid', () => {
    const a = normalizarAudiencia({ alcance: 'PERSONAS', personas: [UNO, 'basura', ' ', DOS] })
    expect(a.personas).toEqual([UNO, DOS])
  })
  it('no se repiten: una persona dos veces es una fila, no dos mensajes', () => {
    const a = normalizarAudiencia({ alcance: 'PERSONAS', personas: [UNO, UNO, ` ${UNO} `] })
    expect(a.personas).toEqual([UNO])
  })
})

describe('el rol (cargo de la nómina)', () => {
  it('se normaliza en mayúsculas y sin espacios de más', () => {
    expect(normalizarCargo('  operario   aseo ')).toBe('OPERARIO ASEO')
  })
  it('vacío significa «todos los cargos», no «ningún cargo»', () => {
    expect(normalizarAudiencia({ cargos: [] }).cargos).toEqual([])
    expect(normalizarAudiencia({ cargos: ['', '   '] }).cargos).toEqual([])
  })
  it('no se repiten aunque vengan escritos distinto', () => {
    expect(normalizarAudiencia({ cargos: ['Conserje', 'CONSERJE', ' conserje '] }).cargos)
      .toEqual(['CONSERJE'])
  })
})

describe('el filtro de turno', () => {
  it('por defecto no filtra', () => {
    expect(normalizarAudiencia({}).turno).toBe('CUALQUIERA')
  })
  it('acepta en turno y fuera de turno', () => {
    expect(normalizarAudiencia({ turno: 'en_turno' }).turno).toBe('EN_TURNO')
    expect(normalizarAudiencia({ turno: 'FUERA_TURNO' }).turno).toBe('FUERA_TURNO')
  })
  it('un valor inventado no filtra en vez de filtrar mal', () => {
    expect(normalizarAudiencia({ turno: 'NOCTURNO' }).turno).toBe('CUALQUIERA')
  })
})

describe('las variables de la plantilla', () => {
  it('son las líneas, en orden, sin las vacías', () => {
    expect(variablesDeTexto('{nombre}\n\n  Aviso de la puerta 2  \n')).toEqual([
      '{nombre}', 'Aviso de la puerta 2',
    ])
  })
  it('un texto vacío no genera variables', () => {
    expect(variablesDeTexto('')).toEqual([])
    expect(variablesDeTexto(null)).toEqual([])
  })
})

describe('los marcadores del mensaje', () => {
  it('la lista es cerrada e incluye la próxima parada', () => {
    expect(MARCADORES).toContain('punto')
    expect(MARCADORES).toContain('punto_nombre')
    expect(MARCADORES).toContain('nombre')
  })
  it('un marcador bien escrito no se reporta', () => {
    expect(marcadoresDesconocidos('Hola {nombre}, en {sede} a las {hora}')).toEqual([])
  })
  it('un marcador mal escrito se avisa: saldría tal cual a cientos de personas', () => {
    expect(marcadoresDesconocidos('Hola {nombe}')).toEqual(['nombe'])
  })
  it('no distingue mayúsculas al avisar, y no repite', () => {
    expect(marcadoresDesconocidos('{Telefono} y {telefono}')).toEqual(['telefono'])
  })
  it('un texto sin llaves no reporta nada', () => {
    expect(marcadoresDesconocidos('Mañana el ingreso es por la puerta 2.')).toEqual([])
  })
})

describe('el resumen que devuelve la base', () => {
  it('se lee con los motivos en español y ordenados por cantidad', () => {
    const r = leerResumen({
      destinos: 12,
      excluidos: 30,
      exclusiones: { SIN_CANAL: 4, SIN_CONSENTIMIENTO: 25, PERSONA_INACTIVA: 1 },
    })
    expect(r.destinos).toBe(12)
    expect(r.excluidos).toBe(30)
    expect(r.exclusiones.map((x) => x.motivo)).toEqual([
      'SIN_CONSENTIMIENTO', 'SIN_CANAL', 'PERSONA_INACTIVA',
    ])
    expect(r.exclusiones[0].legible).toBe('no dio permiso de WhatsApp')
  })
  it('un resumen vacío no rompe la pantalla', () => {
    expect(leerResumen(null)).toEqual({ destinos: 0, excluidos: 0, exclusiones: [] })
  })
  it('un motivo que no conoce se muestra legible igual', () => {
    const r = leerResumen({ destinos: 0, excluidos: 1, exclusiones: { MOTIVO_NUEVO: 1 } })
    expect(r.exclusiones[0].legible).toBe('motivo nuevo')
  })
})
