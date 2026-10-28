// El reloj del SLA del CRM (F11): días y horas HÁBILES, con festivos, y la
// pausa.
//
// Esto es lo que más se rompe solo de todo el módulo, y lo que se rompe en
// silencio: un plazo mal calculado no da error, simplemente marca incumplido a
// alguien que contestó a tiempo —o deja de marcar a alguien que no—. No hay
// forma de darse cuenta mirando la pantalla.
//
// LA TABLA DE CASOS NO ESTÁ ACÁ, a propósito: está en
// apps/inventario/lib/crm/casos-sla.json, y `scripts/verificar-crm-f11.mjs`
// corre LA MISMA tabla contra `crm_sumar_habiles_min()` y
// `crm_minutos_habiles()` en PostgreSQL. La aritmética existe dos veces (en SQL
// porque la RPC calcula el plazo, en TypeScript porque la bandeja no puede
// preguntarle a la base por cada fila de la lista), y el único seguro contra
// que se separen es que las dos se midan con la misma vara.

import { describe, expect, it } from 'vitest'
import casos from '@/lib/crm/casos-sla.json'
import {
  esHabil, fechaLocal, formatearMinutos, leerSlaCon, minutosDePausa, minutosHabiles,
  minutosPorDia, semaforoSla, sumarHabiles, type OpcionesHabiles, type SlaEntrada,
} from '@/lib/crm/sla'

const FRANJA: OpcionesHabiles = {
  desdeHora: casos.franja.desdeHora,
  hastaHora: casos.franja.hastaHora,
  zona: casos.franja.zona,
  noHabiles: casos.noHabiles,
}

const opcionesDe = (franja?: { desdeHora: string; hastaHora: string; zona: string }): OpcionesHabiles =>
  franja ? { ...franja, noHabiles: casos.noHabiles } : FRANJA

describe('sumarHabiles — la misma tabla que corre contra PostgreSQL', () => {
  for (const caso of casos.sumar) {
    it(caso.nombre, () => {
      const r = sumarHabiles(new Date(caso.desde), caso.minutos, opcionesDe(caso.franja))
      expect(r).not.toBeNull()
      expect(r!.toISOString()).toBe(new Date(caso.espera).toISOString())
    })
  }
})

describe('minutosHabiles — la misma tabla que corre contra PostgreSQL', () => {
  for (const caso of casos.transcurrido) {
    it(caso.nombre, () => {
      expect(minutosHabiles(new Date(caso.desde), new Date(caso.hasta), opcionesDe(caso.franja)))
        .toBe(caso.espera)
    })
  }
})

describe('el calendario de festivos es el que manda', () => {
  // El calendario es `pqrs_dias_no_habiles`, el que ya comparten PQRS y No
  // conformes. Lo que esta prueba defiende es que CARGARLO cambie el plazo: si
  // alguien escribiera un calendario propio para el CRM, o lo ignorara, esto
  // seguiría pasando con la tabla de arriba y fallaría acá.
  const viernes = new Date('2026-10-30T16:00:00-05:00')

  it('sin festivos cargados, dos horas desde el viernes a las 16:00 caen el lunes', () => {
    const r = sumarHabiles(viernes, 120, { ...FRANJA, noHabiles: [] })
    expect(fechaLocal(r!, FRANJA.zona)).toBe('2026-11-02')
  })

  it('con el festivo del lunes cargado, caen el martes', () => {
    const r = sumarHabiles(viernes, 120, FRANJA)
    expect(fechaLocal(r!, FRANJA.zona)).toBe('2026-11-03')
  })

  it('un festivo que cae en sábado no cambia nada (ya no era hábil)', () => {
    const conSabado = { ...FRANJA, noHabiles: [...casos.noHabiles, '2026-10-31'] }
    expect(sumarHabiles(viernes, 120, conSabado)!.toISOString())
      .toBe(sumarHabiles(viernes, 120, FRANJA)!.toISOString())
  })

  it('esHabil distingue fin de semana, festivo y día de trabajo', () => {
    expect(esHabil('2026-10-28', casos.noHabiles)).toBe(true)   // miércoles
    expect(esHabil('2026-10-31', casos.noHabiles)).toBe(false)  // sábado
    expect(esHabil('2026-11-01', casos.noHabiles)).toBe(false)  // domingo
    expect(esHabil('2026-11-02', casos.noHabiles)).toBe(false)  // festivo
    expect(esHabil('2026-11-03', casos.noHabiles)).toBe(true)   // martes
  })
})

describe('los bordes del reloj', () => {
  it('una franja que cruza la medianoche no se calcula: devuelve null, no gira', () => {
    const nocturna: OpcionesHabiles = { ...FRANJA, desdeHora: '20:00', hastaHora: '06:00' }
    expect(sumarHabiles(new Date('2026-10-28T21:00:00-05:00'), 60, nocturna)).toBeNull()
    expect(minutosHabiles(new Date('2026-10-28T21:00:00-05:00'),
                          new Date('2026-10-29T05:00:00-05:00'), nocturna)).toBeNull()
  })

  it('un plazo absurdo devuelve null en vez de colgar la consulta', () => {
    // El tope es de 1.000 vueltas, igual que en PostgreSQL: casi cuatro años de
    // plazo. Girar dentro de una consulta que Supabase corta a los 8 segundos
    // es peor que devolver null y que se vea.
    expect(sumarHabiles(new Date('2026-10-28T09:00:00-05:00'), 540 * 2000, FRANJA)).toBeNull()
  })

  it('minutos negativos se tratan como cero', () => {
    const r = sumarHabiles(new Date('2026-10-28T09:00:00-05:00'), -500, FRANJA)
    expect(r!.toISOString()).toBe(new Date('2026-10-28T09:00:00-05:00').toISOString())
  })

  it('la franja por defecto son 540 minutos: nueve horas de lunes a viernes', () => {
    expect(minutosPorDia(FRANJA)).toBe(540)
  })

  it('exactamente en el cierre, el reloj ya pasó al día siguiente', () => {
    const r = sumarHabiles(new Date('2026-10-28T17:00:00-05:00'), 10, FRANJA)
    expect(r!.toISOString()).toBe(new Date('2026-10-29T08:10:00-05:00').toISOString())
  })

  it('exactamente en la apertura, cuenta desde ahí', () => {
    const r = sumarHabiles(new Date('2026-10-28T08:00:00-05:00'), 10, FRANJA)
    expect(r!.toISOString()).toBe(new Date('2026-10-28T08:10:00-05:00').toISOString())
  })
})

/* ──────────────────────────── La pausa del reloj ──────────────────────────── */

const BASE: SlaEntrada = {
  arrancaAt: '2026-10-28T09:00:00-05:00',  // miércoles 9 de la mañana
  minutosPrimeraRespuesta: 120,            // 2 horas hábiles  (prioridad ALTA)
  minutosResolucion: 1080,                 // 2 días hábiles
  horasHabiles: true,
  jornadaDesde: '08:00',
  jornadaHasta: '17:00',
  zona: 'America/Bogota',
  pausadoMin: 0,
}

describe('la pausa del reloj', () => {
  it('sin pausa, el plazo de resolución es dos días hábiles', () => {
    const r = leerSlaCon(BASE, new Date('2026-10-28T10:00:00-05:00'), FRANJA)
    // mié 09:00 + 1080 hábiles = mié 480, jue 540, vie 60 → vie 08:00+60 = 09:00
    expect(r.venceResolucion!.toISOString()).toBe(new Date('2026-10-30T09:00:00-05:00').toISOString())
    expect(r.vencePrimera!.toISOString()).toBe(new Date('2026-10-28T11:00:00-05:00').toISOString())
  })

  it('pausado_min corre el vencimiento de resolución exactamente ese tanto', () => {
    const sin = leerSlaCon(BASE, new Date('2026-10-28T10:00:00-05:00'), FRANJA)
    const con = leerSlaCon({ ...BASE, pausadoMin: 120 },
                           new Date('2026-10-28T10:00:00-05:00'), FRANJA)
    expect(minutosHabiles(sin.venceResolucion!, con.venceResolucion!, FRANJA)).toBe(120)
  })

  it('la pausa NO corre el vencimiento de la primera respuesta', () => {
    // Contestar por primera vez no depende de nadie más: ese reloj no se para.
    const sin = leerSlaCon(BASE, new Date('2026-10-28T10:00:00-05:00'), FRANJA)
    const con = leerSlaCon({ ...BASE, pausadoMin: 480 },
                           new Date('2026-10-28T10:00:00-05:00'), FRANJA)
    expect(con.vencePrimera!.toISOString()).toBe(sin.vencePrimera!.toISOString())
  })

  it('UN RELOJ EN PAUSA NO PUEDE QUEDAR INCUMPLIDO', () => {
    // Es la mitad que se olvida de «se puede pausar»: si venciera igual, la
    // pausa no serviría de nada.
    const muyTarde = new Date('2026-11-20T10:00:00-05:00')
    const corriendo = leerSlaCon(BASE, muyTarde, FRANJA)
    expect(corriendo.incumplido).toBe(true)

    const enPausa = leerSlaCon(
      { ...BASE, primeraRespuestaAt: '2026-10-28T10:00:00-05:00',
        pausadoDesde: '2026-10-28T11:00:00-05:00' },
      muyTarde, FRANJA)
    expect(enPausa.enPausa).toBe(true)
    expect(enPausa.incumplido).toBe(false)
    expect(enPausa.incumplidoQue).toBeNull()
    expect(semaforoSla(enPausa)).toBe('PAUSA')
  })

  it('lo que estuvo parado se mide en minutos hábiles, no de reloj de pared', () => {
    // El caso del comentario de la migración: en espera del viernes a las 16:00
    // al martes a las 9:00 (el lunes es festivo).
    const desde = new Date('2026-10-30T16:00:00-05:00')
    const hasta = new Date('2026-11-03T09:00:00-05:00')
    expect(minutosDePausa(desde, hasta, true, FRANJA)).toBe(120)

    const dePared = Math.floor((hasta.getTime() - desde.getTime()) / 60000)
    expect(dePared).toBe(5340) // 89 horas de reloj de pared frente a 2 hábiles
    expect(minutosDePausa(desde, hasta, false, FRANJA)).toBe(dePared)
  })

  it('una pausa de minutos no se convierte en días por cruzar la noche', () => {
    // 16:55 → 08:05 del día siguiente son 15 minutos hábiles, no 790.
    expect(minutosDePausa(new Date('2026-10-28T16:55:00-05:00'),
                          new Date('2026-10-29T08:05:00-05:00'), true, FRANJA)).toBe(10)
  })

  it('una pausa negativa (relojes desfasados) no resta tiempo', () => {
    expect(minutosDePausa(new Date('2026-10-29T09:00:00-05:00'),
                          new Date('2026-10-28T09:00:00-05:00'), true, FRANJA)).toBe(0)
  })

  it('el incumplimiento distingue primera respuesta, resolución y las dos', () => {
    const tarde = new Date('2026-10-28T12:00:00-05:00')  // pasó la primera (11:00)
    const soloPrimera = leerSlaCon(BASE, tarde, FRANJA)
    expect(soloPrimera.incumplidoQue).toBe('PRIMERA')

    const soloResolucion = leerSlaCon(
      { ...BASE, primeraRespuestaAt: '2026-10-28T09:30:00-05:00' },
      new Date('2026-11-20T10:00:00-05:00'), FRANJA)
    expect(soloResolucion.incumplidoQue).toBe('RESOLUCION')

    const ambos = leerSlaCon(BASE, new Date('2026-11-20T10:00:00-05:00'), FRANJA)
    expect(ambos.incumplidoQue).toBe('AMBOS')
  })

  it('contestar y resolver apagan sus relojes', () => {
    const r = leerSlaCon(
      { ...BASE, primeraRespuestaAt: '2026-10-28T09:30:00-05:00',
        resueltoAt: '2026-10-28T10:00:00-05:00' },
      new Date('2026-11-20T10:00:00-05:00'), FRANJA)
    expect(r.incumplido).toBe(false)
    expect(r.restaPrimeraMin).toBeNull()
    expect(r.restaResolucionMin).toBeNull()
  })

  it('un SLA 24/7 no mira el calendario', () => {
    const r = leerSlaCon(
      { ...BASE, horasHabiles: false, minutosResolucion: 60 },
      new Date('2026-10-28T09:30:00-05:00'), FRANJA)
    expect(r.venceResolucion!.toISOString()).toBe(new Date('2026-10-28T10:00:00-05:00').toISOString())
  })

  it('el semáforo avisa cuando queda menos de una hora', () => {
    expect(semaforoSla(leerSlaCon(BASE, new Date('2026-10-28T10:30:00-05:00'), FRANJA))).toBe('APRETADO')
    expect(semaforoSla(leerSlaCon(BASE, new Date('2026-10-28T09:05:00-05:00'), FRANJA))).toBe('BIEN')
    expect(semaforoSla(leerSlaCon(BASE, new Date('2026-10-28T13:00:00-05:00'), FRANJA))).toBe('VENCIDO')
  })
})

describe('formatearMinutos', () => {
  it('dice minutos, horas y días hábiles, y cuándo está vencido', () => {
    expect(formatearMinutos(45)).toBe('45 min')
    expect(formatearMinutos(120)).toBe('2 h')
    expect(formatearMinutos(150)).toBe('2 h 30 min')
    expect(formatearMinutos(540)).toBe('1 día hábil')
    expect(formatearMinutos(1080)).toBe('2 días hábiles')
    expect(formatearMinutos(1140)).toBe('2 días y 1 h hábiles')
    expect(formatearMinutos(-40)).toBe('vencido hace 40 min')
    expect(formatearMinutos(null)).toBe('—')
  })

  it('en 24/7 no habla de días hábiles', () => {
    expect(formatearMinutos(600, false)).toBe('10 h')
  })
})
