// El barrido por lotes del rastro de ubicación (F8).
//
// Lo que se prueba acá no es el borrado —eso lo hace la base y lo comprueba
// `scripts/probar-puntos-qr-f8.mjs` contra PostgreSQL— sino el BUCLE, que es lo
// único que vive en TypeScript y lo único que puede colgarse: cuándo vuelve a
// llamar, cuándo para, y qué pasa cuando hay más trabajo del que cabe en una
// corrida del cron.
//
// El modo de falla que fija la última prueba es el que importa: sin tope de
// vueltas, el día que alguien baje la retención de 12 meses a 1 esta ruta se
// quedaría borrando hasta que Vercel la corte a los 60 s, y un cron que siempre
// muere por tiempo no se distingue de uno que está roto.

import { describe, expect, it } from 'vitest'
import {
  barrerUbicacion, LOTE_PURGA, LOTE_TURNOS, MAX_VUELTAS,
} from '@/lib/ronda/barrido-ubicacion'

/** Un cliente de mentira que devuelve, por función, lo que diga el guion. */
function clienteCon(guion: Record<string, number[]>) {
  const llamadas: { fn: string; lote: number }[] = []
  const resto: Record<string, number[]> = JSON.parse(JSON.stringify(guion))
  return {
    llamadas,
    rpc: async (fn: string, args: { p_lote: number }) => {
      llamadas.push({ fn, lote: args.p_lote })
      const cola = resto[fn] ?? []
      return { data: cola.length ? cola.shift() : 0, error: null }
    },
  }
}

const PURGA = 'ronda_purgar_ubicacion'
const TURNOS = 'ronda_turnos_cerrar_vencidos'

describe('barrerUbicacion', () => {
  it('no vuelve a llamar cuando el primer lote sale corto', async () => {
    const sb = clienteCon({ [PURGA]: [12], [TURNOS]: [3] })
    const r = await barrerUbicacion(sb)

    expect(r).toEqual({ purgados: 12, turnosCerrados: 3, quedaPendiente: false })
    expect(sb.llamadas.filter((l) => l.fn === PURGA)).toHaveLength(1)
    expect(sb.llamadas.filter((l) => l.fn === TURNOS)).toHaveLength(1)
  })

  it('con nada que hacer llama una vez a cada una y devuelve ceros', async () => {
    const sb = clienteCon({})
    const r = await barrerUbicacion(sb)

    expect(r).toEqual({ purgados: 0, turnosCerrados: 0, quedaPendiente: false })
    expect(sb.llamadas).toHaveLength(2)
  })

  it('sigue llamando mientras el lote salga lleno, y suma', async () => {
    const sb = clienteCon({ [PURGA]: [LOTE_PURGA, LOTE_PURGA, 7] })
    const r = await barrerUbicacion(sb)

    expect(r.purgados).toBe(LOTE_PURGA * 2 + 7)
    expect(r.quedaPendiente).toBe(false)
    expect(sb.llamadas.filter((l) => l.fn === PURGA)).toHaveLength(3)
  })

  it('cierra los turnos ANTES de purgar', async () => {
    const sb = clienteCon({ [PURGA]: [1], [TURNOS]: [1] })
    await barrerUbicacion(sb)

    expect(sb.llamadas.map((l) => l.fn)).toEqual([TURNOS, PURGA])
  })

  it('manda el tamaño de lote que la base sabe acotar', async () => {
    const sb = clienteCon({})
    await barrerUbicacion(sb)

    expect(sb.llamadas.find((l) => l.fn === PURGA)!.lote).toBe(LOTE_PURGA)
    expect(sb.llamadas.find((l) => l.fn === TURNOS)!.lote).toBe(LOTE_TURNOS)
  })

  it('si el trabajo no cabe, para en el tope y lo dice en vez de quedarse colgado', async () => {
    // Lotes siempre llenos: sin tope, esto no terminaría nunca.
    const sb = clienteCon({ [PURGA]: Array(MAX_VUELTAS + 5).fill(LOTE_PURGA) })
    const r = await barrerUbicacion(sb)

    expect(sb.llamadas.filter((l) => l.fn === PURGA)).toHaveLength(MAX_VUELTAS)
    expect(r.quedaPendiente).toBe(true)
    expect(r.purgados).toBe(LOTE_PURGA * MAX_VUELTAS)
  })

  it('un error de la base sube con el nombre de la función que falló', async () => {
    const sb = {
      rpc: async (fn: string) => ({ data: null, error: { message: 'permission denied' } }),
    }
    await expect(barrerUbicacion(sb)).rejects.toThrow(`${TURNOS}: permission denied`)
  })
})
