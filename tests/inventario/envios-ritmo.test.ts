// El ritmo de un envío masivo (Puntos QR F10).
//
// POR QUÉ IMPORTA: el número en coexistencia tiene un tope FIJO de 20 mensajes
// por segundo que no se puede subir. Si el reparto de horas usara un caudal
// distinto al que usa el buzón de salida, el sistema prometería un ritmo que no
// puede sostener: los mensajes se acumularían EN_PROCESO y la prioridad —que es
// lo que evita que un aviso a 800 personas deje esperando al conserje parado en
// un punto— dejaría de significar algo.
//
// Estas cuentas son las MISMAS que hace `crm_envio_aprobar()` en SQL
// (`base + indice / mps` segundos). Acá se fijan para que no se muevan solas.

import { describe, expect, it } from 'vitest'
import {
  acotarMps, cabenEn, caudalEfectivo, duracionEnPalabras, horaDelDestino,
  intervaloMs, segundosDeEnvio, TOPE_MPS,
} from '@/lib/envios/ritmo'

describe('el tope del número', () => {
  it('son 20 mensajes por segundo, y no es configuración', () => {
    expect(TOPE_MPS).toBe(20)
  })
  it('pedir más de 20 se recorta a 20', () => {
    expect(acotarMps(50)).toBe(20)
    expect(caudalEfectivo(50, 20)).toBe(20)
  })
  it('un caudal de cero o negativo no detiene la cola: queda en 1', () => {
    expect(acotarMps(0)).toBe(1)
    expect(acotarMps(-3)).toBe(1)
    expect(intervaloMs(0)).toBe(1000)
  })
  it('un caudal pedido en cero es «sin preferencia», no «no mandes nada»', () => {
    // Es la misma semántica que el COALESCE de `crm_envio_aprobar`: si el envío
    // no pide un ritmo, manda el del número.
    expect(caudalEfectivo(0, 20)).toBe(20)
    expect(caudalEfectivo(null, 8)).toBe(8)
  })
  it('manda el menor entre el nuestro y el que informó el número', () => {
    expect(caudalEfectivo(15, 20)).toBe(15)
    expect(caudalEfectivo(15, 8)).toBe(8)
    expect(caudalEfectivo(2, 20)).toBe(2)
  })
  it('si la cuenta no informa caudal, se asume el tope del número', () => {
    expect(caudalEfectivo(15, null)).toBe(15)
    expect(caudalEfectivo(null, null)).toBe(20)
  })
})

describe('el intervalo entre mensajes', () => {
  it('a 15 por segundo se espera 67 ms (redondeando hacia arriba)', () => {
    expect(intervaloMs(15)).toBe(67)
  })
  it('a 2 por segundo, medio segundo', () => {
    expect(intervaloMs(2)).toBe(500)
  })
  it('a 1 por segundo, un segundo', () => {
    expect(intervaloMs(1)).toBe(1000)
  })
})

describe('cuánto tarda un envío', () => {
  it('un solo destinatario sale de inmediato: no hay nada que esperar', () => {
    expect(segundosDeEnvio(1, 15)).toBe(0)
    expect(duracionEnPalabras(1, 15)).toBe('sale de inmediato')
  })
  it('30 destinatarios a 2 por segundo son 14,5 s, no 15', () => {
    // Son los 29 intervalos ENTRE los 30 mensajes: el primero sale ya.
    expect(segundosDeEnvio(30, 2)).toBe(14.5)
  })
  it('800 destinatarios a 15 por segundo son unos 53 s: no es instantáneo', () => {
    expect(Math.round(segundosDeEnvio(800, 15))).toBe(53)
    expect(duracionEnPalabras(800, 15)).toBe('unos 54 s')
  })
  it('6.000 personas a 15 por segundo son casi siete minutos', () => {
    expect(duracionEnPalabras(6000, 15)).toBe('unos 6 min 40 s')
  })
})

describe('el reparto de horas (el escalonado obligatorio)', () => {
  const base = new Date('2026-10-28T12:00:00.000Z')

  it('el primer destino sale en la hora base', () => {
    expect(horaDelDestino(base, 0, 15).toISOString()).toBe('2026-10-28T12:00:00.000Z')
  })
  it('cada destino va un intervalo después del anterior', () => {
    const a = horaDelDestino(base, 10, 2).getTime()
    const b = horaDelDestino(base, 11, 2).getTime()
    expect(b - a).toBe(500)
  })
  it('es la misma cuenta que hace la base: indice / mps segundos', () => {
    expect(horaDelDestino(base, 29, 2).toISOString()).toBe('2026-10-28T12:00:14.500Z')
    expect(horaDelDestino(base, 150, 15).toISOString()).toBe('2026-10-28T12:00:10.000Z')
  })
  it('un índice negativo no manda nada al pasado', () => {
    expect(horaDelDestino(base, -5, 15).getTime()).toBe(base.getTime())
  })
})

describe('cuánto se reclama por vuelta del cron', () => {
  it('en un minuto a 15 por segundo caben 900 mensajes', () => {
    expect(cabenEn(60_000, 15)).toBe(900)
  })
  it('nunca se reclama menos de uno: un lote vacío dejaría la cola quieta', () => {
    expect(cabenEn(10, 15)).toBe(1)
    expect(cabenEn(0, 15)).toBe(1)
  })
  it('pedir 500 filas para un presupuesto de 3 s se recorta a lo que cabe', () => {
    // Reclamar más de lo que se puede mandar deja filas EN_PROCESO esperando el
    // rescate de huérfanos, que son cinco minutos de retraso para esa persona.
    expect(cabenEn(3_000, 15)).toBe(45)
  })
})
