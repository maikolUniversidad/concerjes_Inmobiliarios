// La jornada de mensajería (Ley 2191 de 2022), en la previsualización.
//
// QUIÉN DECIDE: la base. `whatsapp_jornada()` y `crm_envio_siguiente_ventana()`
// son las que aplazan un envío, y además conocen las excepciones autorizadas y
// el estado de la persona en la nómina. Lo que se prueba acá es la cuenta que
// hace la PANTALLA para avisar antes de confirmar: «a esa hora el contrato está
// fuera de jornada, saldría mañana a las 06:00».
//
// Las dos trampas que estas pruebas fijan:
//   1. UNA FRANJA ES UN INTERVALO. 22:00–06:00 cruza la medianoche y es UNA
//      jornada continua. Tratarla como dos trozos dejaría al turno de noche sin
//      poder recibir nada en toda su jornada.
//   2. SE MIDE EN HORA DE COLOMBIA. Calcularlo en UTC daría el día anterior
//      entre las 19:00 y la medianoche, que es justo el final del turno de la
//      tarde.

import { describe, expect, it } from 'vitest'
import {
  dentroDeFranja, franjaEnPalabras, minutosDeHora, minutosLocales, siguienteApertura,
} from '@/lib/envios/jornada'

/** Una hora de Bogotá como instante UTC (Colombia es UTC-5, sin horario de
 *  verano: 08:00 en Bogotá son las 13:00 UTC). */
const bogota = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-05:00`)

describe('leer una hora', () => {
  it('acepta HH:MM y HH:MM:SS', () => {
    expect(minutosDeHora('06:00')).toBe(360)
    expect(minutosDeHora('06:00:00')).toBe(360)
    expect(minutosDeHora('20:30')).toBe(1230)
  })
  it('rechaza lo que no es una hora', () => {
    expect(minutosDeHora('25:00')).toBeNull()
    expect(minutosDeHora('06:70')).toBeNull()
    expect(minutosDeHora('')).toBeNull()
    expect(minutosDeHora(null)).toBeNull()
  })
})

describe('la hora local de Colombia', () => {
  it('las 23:00 UTC son las 18:00 en Bogotá, no las 23:00', () => {
    expect(minutosLocales(new Date('2026-10-28T23:00:00.000Z'))).toBe(18 * 60)
  })
  it('la medianoche de Bogotá cae a las 05:00 UTC del día siguiente', () => {
    expect(minutosLocales(bogota('2026-10-28', '00:00'))).toBe(0)
  })
})

describe('una jornada normal (06:00 a 20:00)', () => {
  const franja = { desde: '06:00', hasta: '20:00' }

  it('a las 10:00 de Bogotá está dentro', () => {
    expect(dentroDeFranja(bogota('2026-10-28', '10:00'), franja)).toBe(true)
  })
  it('a las 05:59 está fuera, y abre a las 06:00 del mismo día', () => {
    const m = bogota('2026-10-28', '05:59')
    expect(dentroDeFranja(m, franja)).toBe(false)
    expect(siguienteApertura(m, franja).toISOString()).toBe(bogota('2026-10-28', '06:00').toISOString())
  })
  it('a las 20:00 ya está fuera: el final no se incluye', () => {
    expect(dentroDeFranja(bogota('2026-10-28', '20:00'), franja)).toBe(false)
  })
  it('a las 21:00 abre a las 06:00 del DÍA SIGUIENTE', () => {
    const m = bogota('2026-10-28', '21:00')
    expect(siguienteApertura(m, franja).toISOString()).toBe(bogota('2026-10-29', '06:00').toISOString())
  })
  it('estando dentro, la siguiente ventana es AHORA', () => {
    const m = bogota('2026-10-28', '10:00')
    expect(siguienteApertura(m, franja).getTime()).toBe(m.getTime())
  })
  it('las 23:00 UTC (18:00 en Bogotá) están DENTRO: medir en UTC lo rompería', () => {
    expect(dentroDeFranja(new Date('2026-10-28T23:00:00.000Z'), franja)).toBe(true)
  })
})

describe('un turno de noche (22:00 a 06:00) es UNA jornada, no dos', () => {
  const noche = { desde: '22:00', hasta: '06:00' }

  it('a las 23:00 está dentro', () => {
    expect(dentroDeFranja(bogota('2026-10-28', '23:00'), noche)).toBe(true)
  })
  it('a las 02:00 sigue dentro: la medianoche no corta la jornada', () => {
    expect(dentroDeFranja(bogota('2026-10-29', '02:00'), noche)).toBe(true)
  })
  it('a las 06:00 ya está fuera', () => {
    expect(dentroDeFranja(bogota('2026-10-29', '06:00'), noche)).toBe(false)
  })
  it('a las 12:00 está fuera y abre a las 22:00 del mismo día', () => {
    const m = bogota('2026-10-28', '12:00')
    expect(dentroDeFranja(m, noche)).toBe(false)
    expect(siguienteApertura(m, noche).toISOString()).toBe(bogota('2026-10-28', '22:00').toISOString())
  })
})

describe('casos de borde del contrato', () => {
  it('desde == hasta son las 24 horas: el contrato no restringe', () => {
    const franja = { desde: '00:00', hasta: '00:00' }
    expect(dentroDeFranja(bogota('2026-10-28', '03:00'), franja)).toBe(true)
    expect(franjaEnPalabras(franja)).toBe('las 24 horas')
  })
  it('sin franja no se afirma nada: se trata como sin restricción', () => {
    expect(dentroDeFranja(bogota('2026-10-28', '03:00'), { desde: '', hasta: '' })).toBe(true)
    expect(franjaEnPalabras(null)).toContain('sin jornada')
  })
  it('la franja se dice en palabras, sin los segundos', () => {
    expect(franjaEnPalabras({ desde: '07:00:00', hasta: '18:00:00' })).toBe('de 07:00 a 18:00')
  })
})
