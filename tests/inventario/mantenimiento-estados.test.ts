import { describe, it, expect } from 'vitest'
import {
  ESTADOS_TICKET, ESTADO_TICKET_META, FASES_TICKET, FASE_SI_NO_SE_CONOCE,
  faseTicket, ESTADOS_TICKET_ACTIVOS, ESTADOS_TICKET_EN_CURSO,
  ESTADOS_TICKET_FINALES, FILTRO_NO_FINAL,
  ACCIONES_TICKET, FRECUENCIA_PLAN_META, FRECUENCIAS_PLAN, textoFrecuencia,
} from '@/lib/mantenimiento'

// Los once valores del enum `estado_ticket_mant` tal como quedaron en la base
// después de F7, en el orden del ciclo de vida. Está escrito a mano aquí a
// propósito: si alguien amplía el enum y no toca el frontend, esta lista y la
// de `lib/mantenimiento.ts` discrepan y la prueba lo dice.
const ENUM_EN_LA_BASE = [
  'ABIERTO', 'RECIBIDO', 'ACEPTADO', 'EN_CAMINO', 'EN_SITIO', 'EN_PROCESO',
  'EN_ESPERA', 'RESUELTO', 'APROBADO_CLIENTE', 'CERRADO', 'CANCELADO',
]

describe('los estados del ticket', () => {
  it('son los mismos que el enum de la base, en el mismo orden', () => {
    expect([...ESTADOS_TICKET]).toEqual(ENUM_EN_LA_BASE)
  })

  it('todos tienen etiqueta y color (ninguno sale como el nombre crudo del enum)', () => {
    for (const e of ESTADOS_TICKET) {
      const meta = ESTADO_TICKET_META[e]
      expect(meta, e).toBeDefined()
      expect(meta.label.trim().length, e).toBeGreaterThan(0)
      expect(meta.label, e).not.toBe(e)
      expect(meta.cls, e).toMatch(/bg-/)
      expect(meta.dot, e).toMatch(/bg-/)
    }
  })

  it('ESTADO_TICKET_META no tiene entradas de más', () => {
    expect(Object.keys(ESTADO_TICKET_META).sort()).toEqual([...ESTADOS_TICKET].sort())
  })
})

describe('el reparto en pestañas', () => {
  it('clasifica TODOS los estados: ninguno queda fuera de todas las pestañas', () => {
    const clasificados = Object.values(FASES_TICKET).flat()
    for (const e of ESTADOS_TICKET) {
      expect(clasificados, `${e} no está en ninguna fase`).toContain(e)
    }
  })

  it('ningún estado está en dos pestañas a la vez', () => {
    const clasificados = Object.values(FASES_TICKET).flat()
    expect(clasificados.length).toBe(new Set(clasificados).size)
  })

  // Esta es LA prueba del módulo. El peor modo de falla del tablero era
  // silencioso: un ticket en un estado que nadie clasificó no aparecía en
  // ninguna pestaña, sin error y sin rastro. `faseTicket` es total, así que un
  // estado futuro cae en una pestaña visible en vez de esfumarse.
  it('un estado que nadie clasificó cae en una pestaña visible, no en el vacío', () => {
    const fase = faseTicket('UN_ESTADO_QUE_NO_EXISTE_TODAVIA')
    expect(fase).toBe(FASE_SI_NO_SE_CONOCE)
    expect(Object.keys(FASES_TICKET)).toContain(fase)
  })

  it('cada estado conocido cae donde dice su fase', () => {
    for (const [fase, estados] of Object.entries(FASES_TICKET)) {
      for (const e of estados) expect(faseTicket(e), e).toBe(fase)
    }
  })
})

describe('las listas derivadas', () => {
  it('lo pendiente es todo lo que no es final', () => {
    expect([...ESTADOS_TICKET_ACTIVOS].sort()).toEqual(
      ESTADOS_TICKET.filter((e) => !(ESTADOS_TICKET_FINALES as readonly string[]).includes(e)).sort(),
    )
  })

  it('lo pendiente incluye los cuatro estados de la orden de trabajo', () => {
    for (const e of ['ACEPTADO', 'EN_CAMINO', 'EN_SITIO', 'APROBADO_CLIENTE']) {
      expect(ESTADOS_TICKET_ACTIVOS, e).toContain(e)
    }
  })

  it('lo que está en curso no incluye lo que espera confirmación', () => {
    expect(ESTADOS_TICKET_EN_CURSO).not.toContain('RESUELTO')
    expect(ESTADOS_TICKET_EN_CURSO).not.toContain('APROBADO_CLIENTE')
    expect(ESTADOS_TICKET_EN_CURSO).toContain('EN_SITIO')
  })

  it('el filtro de PostgREST va en negativo, con los dos estados finales', () => {
    expect(FILTRO_NO_FINAL).toBe('(CERRADO,CANCELADO)')
  })
})

describe('las acciones del autómata', () => {
  it('EN_SITIO no es una acción: lo escribe el escaneo de la placa', () => {
    expect(ACCIONES_TICKET as readonly string[]).not.toContain('EN_SITIO')
  })

  it('están las tres acciones nuevas de la orden de trabajo', () => {
    for (const a of ['ACEPTAR', 'SALIR', 'APROBAR_CLIENTE']) {
      expect(ACCIONES_TICKET as readonly string[], a).toContain(a)
    }
  })

  it('siguen estando las ocho de siempre', () => {
    for (const a of ['RECIBIR', 'ASIGNAR', 'INICIAR', 'ESPERA', 'RESOLVER', 'CERRAR', 'REABRIR', 'CANCELAR']) {
      expect(ACCIONES_TICKET as readonly string[], a).toContain(a)
    }
  })
})

describe('la frecuencia de un plan preventivo', () => {
  it('las cuatro frecuencias tienen metadatos', () => {
    expect(Object.keys(FRECUENCIA_PLAN_META).sort()).toEqual([...FRECUENCIAS_PLAN].sort())
  })

  it('se lee en español y concuerda en singular', () => {
    expect(textoFrecuencia('MESES', 3)).toBe('cada 3 meses')
    expect(textoFrecuencia('MESES', 1)).toBe('cada 1 mes')
    expect(textoFrecuencia('DIAS', 15)).toBe('cada 15 días')
    expect(textoFrecuencia('SEMANAS', 1)).toBe('cada 1 semana')
  })

  it('la de medidor usa la unidad del contador', () => {
    expect(textoFrecuencia('MEDIDOR', 500, 'horas')).toBe('cada 500 horas')
    expect(textoFrecuencia('MEDIDOR', 500, null)).toBe('cada 500 unidades')
  })
})
