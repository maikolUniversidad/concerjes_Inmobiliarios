import { describe, it, expect } from 'vitest'
import {
  ESTADOS_TICKET, ESTADO_TICKET_META, FASES_TICKET, FASE_SI_NO_SE_CONOCE,
  faseTicket, ESTADOS_TICKET_ACTIVOS, ESTADOS_TICKET_EN_CURSO,
  ESTADOS_TICKET_FINALES, FILTRO_NO_FINAL,
  ACCIONES_TICKET, FRECUENCIA_PLAN_META, FRECUENCIAS_PLAN, textoFrecuencia,
  clasificarEscaneoOT, extraerReferenciaEquipo,
} from '@/lib/mantenimiento'
import { formatearManual } from '@/lib/puntos-qr'

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

// `/mantenimiento` estaba en producción antes de F7, y lo que se le cambió son
// justo las pestañas y los KPI. Esto reproduce EXACTAMENTE la aritmética del
// tablero (`TableroClient.tsx`: la pestaña «Todos» no filtra, y cada otra
// cuenta `faseTicket(estado) === v.k`) sobre los once estados reales más uno
// inventado, para fijar la única cosa que no puede fallar: que ningún ticket
// quede fuera de todas las pestañas.
describe('la aritmética de las pestañas del tablero', () => {
  const PESTANAS = ['atender', 'curso', 'resueltos', 'historial'] as const
  const tickets = [...ESTADOS_TICKET, 'UN_ESTADO_QUE_NADIE_CLASIFICO']
    .map((estado, i) => ({ id: String(i), estado }))

  const contar = (p: string) => tickets.filter((t) => faseTicket(t.estado) === p).length

  it('la suma de las cuatro pestañas es igual al total de «Todos»', () => {
    const suma = PESTANAS.reduce((a, p) => a + contar(p), 0)
    expect(suma).toBe(tickets.length)
  })

  it('ningún ticket se cuenta dos veces', () => {
    const vistos = PESTANAS.flatMap((p) => tickets.filter((t) => faseTicket(t.estado) === p).map((t) => t.id))
    expect(vistos.length).toBe(new Set(vistos).size)
  })

  it('el reparto concreto de los once estados es el esperado', () => {
    // Si alguien mueve un estado de pestaña, esta prueba lo dice con nombres.
    expect(contar('atender')).toBe(1)    // ABIERTO
    expect(contar('curso')).toBe(7)      // los 6 de curso + el no clasificado
    expect(contar('resueltos')).toBe(2)  // RESUELTO, APROBADO_CLIENTE
    expect(contar('historial')).toBe(2)  // CERRADO, CANCELADO
  })

  it('el ticket con un estado desconocido SÍ aparece en una pestaña', () => {
    const cual = PESTANAS.filter((p) => faseTicket('UN_ESTADO_QUE_NADIE_CLASIFICO') === p)
    expect(cual).toHaveLength(1)
    expect(cual[0]).toBe('curso')
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

// El fallo que F7 trajo y que solo se vio probando la pantalla: se le pasaba a
// la base la URL ENTERA de la placa en vez del token, y `ronda_qr` se busca por
// token exacto. El técnico escaneaba una placa buena, recibía «esa placa no
// está registrada» y quedaba empujado a la apertura manual — justo la
// distinción que el estado EN_SITIO existe para proteger.
//
// Las cuatro formas que tiene que aguantar, fijadas aquí para que no se repita.
describe('qué se escaneó al abrir una orden en sitio', () => {
  // Token de 21 caracteres con la forma del ADR-B: <v><clave 8><version 2><firma 10>.
  const TOKEN = '1K7M4QX9T01A9F3C1B7E2'
  const MANUAL = 'K7M4QX9T'

  it('1 · la URL de una placa de activo o de punto → el token limpio', () => {
    const r = clasificarEscaneoOT(`https://inventario.example.com/q/${TOKEN}`)
    expect(r).toEqual({ tipo: 'QR', codigo: TOKEN, modo: 'QR' })
  })

  it('1b · aguanta la URL con query, ancla o barra final', () => {
    for (const u of [
      `https://inventario.example.com/q/${TOKEN}?v=2`,
      `https://inventario.example.com/q/${TOKEN}#arriba`,
      `http://localhost:3000/q/${TOKEN}`,
    ]) {
      const r = clasificarEscaneoOT(u)
      expect(r.tipo, u).toBe('QR')
      if (r.tipo === 'QR') expect(r.codigo, u).toBe(TOKEN)
    }
  })

  it('2 · la URL de un equipo propio → la referencia del equipo, no un token', () => {
    const r = clasificarEscaneoOT('https://inventario.example.com/equipo/MAQ-0012')
    expect(r).toEqual({ tipo: 'EQUIPO', referencia: 'MAQ-0012' })
  })

  it('3 · el token suelto, tecleado o leído sin URL', () => {
    expect(clasificarEscaneoOT(TOKEN)).toEqual({ tipo: 'QR', codigo: TOKEN, modo: 'QR' })
    expect(clasificarEscaneoOT(`  ${TOKEN.toLowerCase()}  `))
      .toEqual({ tipo: 'QR', codigo: TOKEN, modo: 'QR' })
  })

  it('4 · el código manual con guion, que es como está impreso bajo el QR', () => {
    expect(formatearManual(MANUAL)).toBe('K7M4-QX9T')
    const r = clasificarEscaneoOT('K7M4-QX9T')
    // Se reconoce como manual, NO como token: pesa distinto en el informe.
    expect(r).toEqual({ tipo: 'QR', codigo: MANUAL, modo: 'MANUAL' })
    expect(clasificarEscaneoOT('k7m4 qx9t')).toEqual({ tipo: 'QR', codigo: MANUAL, modo: 'MANUAL' })
  })

  it('lo que no tiene forma de nada se dice, no se adivina', () => {
    for (const basura of ['', '   ', 'hola', 'https://example.com/otra/cosa', '12']) {
      expect(clasificarEscaneoOT(basura).tipo, JSON.stringify(basura)).toBe('DESCONOCIDO')
    }
  })

  it('NUNCA devuelve una URL como si fuera un código (el fallo original)', () => {
    for (const u of [
      `https://inventario.example.com/q/${TOKEN}`,
      'https://inventario.example.com/equipo/MAQ-0012',
      'https://example.com/otra/cosa',
    ]) {
      const r = clasificarEscaneoOT(u)
      const valor = r.tipo === 'QR' ? r.codigo : r.tipo === 'EQUIPO' ? r.referencia : ''
      expect(valor, u).not.toContain('/')
      expect(valor, u).not.toContain('http')
    }
  })

  it('el extractor de equipo sigue intacto para /equipo', () => {
    // No se tocó: lo usan /equipo y la ficha de campo.
    expect(extraerReferenciaEquipo('https://x/equipo/MAQ-0012')).toBe('MAQ-0012')
    expect(extraerReferenciaEquipo('MAQ-0012')).toBe('MAQ-0012')
  })
})
