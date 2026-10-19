// Cola de MEDIOS del ADR-D: los archivos suben antes que el intent que los
// referencia, con reintento y espera creciente, y una visita no manda su cierre
// si una de sus fotos no subió.
import { describe, expect, it } from 'vitest'
import {
  InMemoryMedioStore, InMemoryStore, PushRegistry, encolar, esperaBackoffMs,
  descartarMedio, pushOutboxPorGrupo, resumenMedios, subirMedios,
  type MedioPendiente, type Sb,
} from '../../packages/offline/src'

const medio = (id: string, grupo = 'v1'): MedioPendiente => ({
  id, grupo, ruta: `${grupo}/${id}.jpg`, mime: 'image/jpeg',
  sha256: id.padEnd(64, '0'), tamano: 1024, blob: 'bytes',
  creadoEn: `2026-10-19T12:00:0${id.slice(-1)}.000Z`, intentos: 0,
})

describe('cola de medios', () => {
  it('sube en orden de creación y deja la cola vacía', async () => {
    const store = new InMemoryMedioStore()
    await store.addMedio(medio('f2'))
    await store.addMedio(medio('f1'))
    const subidas: string[] = []
    const r = await subirMedios(store, async (m) => { subidas.push(m.id); return m.ruta })
    expect(r.subidos).toBe(2)
    expect(subidas).toEqual(['f1', 'f2'])
    expect(await store.getMedios()).toHaveLength(0)
  })

  it('reintenta con espera creciente y no vuelve a intentar antes de la hora', async () => {
    const store = new InMemoryMedioStore()
    await store.addMedio(medio('f1'))
    const t0 = new Date('2026-10-19T12:00:00.000Z')
    const falla = async () => { throw new Error('sin señal') }

    const r1 = await subirMedios(store, falla, undefined, { ahora: () => t0 })
    expect(r1.subidos).toBe(0)
    expect(r1.errores[0]).toContain('sin señal')
    const [m1] = await store.getMedios()
    expect(m1.intentos).toBe(1)
    expect(m1.reintentarDespuesDe).toBe('2026-10-19T12:00:02.000Z')

    // Un segundo después todavía no toca: no se gasta batería intentando.
    let intentos = 0
    const r2 = await subirMedios(store, async (m) => { intentos++; return m.ruta },
      undefined, { ahora: () => new Date('2026-10-19T12:00:01.000Z') })
    expect(intentos).toBe(0)
    expect(r2.pendientes).toBe(1)

    // Pasada la espera, sí.
    const r3 = await subirMedios(store, async (m) => m.ruta,
      undefined, { ahora: () => new Date('2026-10-19T12:00:05.000Z') })
    expect(r3.subidos).toBe(1)
  })

  it('la espera dobla en cada intento', () => {
    expect(esperaBackoffMs(1, 2000)).toBe(2000)
    expect(esperaBackoffMs(2, 2000)).toBe(4000)
    expect(esperaBackoffMs(6, 2000)).toBe(64000)
  })

  it('después del tope queda atascado y se puede descartar con motivo', async () => {
    const store = new InMemoryMedioStore()
    await store.addMedio({ ...medio('f1'), intentos: 6 })
    const r = await subirMedios(store, async (m) => m.ruta)
    expect(r.atascados).toEqual(['f1'])
    expect(r.subidos).toBe(0)

    expect(await descartarMedio(store, 'f1', 'el archivo se corrompió')).toBe(true)
    const [m] = await store.getMedios()
    expect(m.descarteMotivo).toBe('el archivo se corrompió')
    // Descartado NO es borrado: la visita puede explicar qué pasó.
    const r2 = await subirMedios(store, async (x) => x.ruta)
    expect(r2.subidos).toBe(0)
  })

  it('el resumen agrupa por visita, que es lo que muestra la pantalla de la cola', async () => {
    const store = new InMemoryMedioStore()
    await store.addMedio(medio('f1', 'v1'))
    await store.addMedio(medio('f2', 'v1'))
    await store.addMedio(medio('f3', 'v2'))
    const r = await resumenMedios(store)
    expect(r.v1.pendientes).toBe(2)
    expect(r.v1.bytes).toBe(2048)
    expect(r.v2.pendientes).toBe(1)
  })
})

describe('push en orden por grupo', () => {
  const sbFalso = (falla: (kind: string) => boolean) => {
    const vistos: string[] = []
    const sb = {
      from: () => ({}),
      async rpc(fn: string) {
        vistos.push(fn)
        return { data: null, error: falla(fn) ? { message: 'sin señal' } : null }
      },
    } as unknown as Sb
    return { sb, vistos }
  }

  const registry = new PushRegistry()
    .on('ronda:visita', async (sb, p) => {
      const { error } = await sb.rpc('ronda_registrar_visita', p)
      if (error) throw new Error(error.message)
    })
    .on('ronda:evidencia', async (sb, p) => {
      const { error } = await sb.rpc('ronda_adjuntar_evidencia', p)
      if (error) throw new Error(error.message)
    })
    .on('ronda:cierre', async (sb, p) => {
      const { error } = await sb.rpc('ronda_cerrar_visita', p)
      if (error) throw new Error(error.message)
    })

  const encolarVisita = async (store: InMemoryStore, grupo: string) => {
    await encolar(store, 'ronda:visita', { p_visita: grupo }, undefined, { grupo, orden: 0 })
    await encolar(store, 'ronda:evidencia', { p_visita: grupo }, undefined, { grupo, orden: 1 })
    await encolar(store, 'ronda:cierre', { p_visita: grupo }, undefined, { grupo, orden: 2 })
  }

  it('manda los intents de la visita en el orden en que se encolaron', async () => {
    const store = new InMemoryStore()
    await encolarVisita(store, 'v1')
    const { sb, vistos } = sbFalso(() => false)
    const r = await pushOutboxPorGrupo(sb, store, registry)
    expect(r.pushed).toBe(3)
    expect(vistos).toEqual([
      'ronda_registrar_visita', 'ronda_adjuntar_evidencia', 'ronda_cerrar_visita'])
  })

  it('si una evidencia falla, el CIERRE de esa visita no se manda', async () => {
    const store = new InMemoryStore()
    await encolarVisita(store, 'v1')
    const { sb, vistos } = sbFalso((fn) => fn === 'ronda_adjuntar_evidencia')
    const r = await pushOutboxPorGrupo(sb, store, registry)
    expect(vistos).not.toContain('ronda_cerrar_visita')
    expect(r.gruposDetenidos).toEqual(['v1'])
    // Y lo que no se mandó sigue en la cola para la próxima vez.
    const quedan = await store.getOutbox()
    expect(quedan.map((x) => x.kind)).toEqual(['ronda:evidencia', 'ronda:cierre'])
  })

  it('una visita atascada no detiene a las demás', async () => {
    const store = new InMemoryStore()
    await encolarVisita(store, 'v1')
    await encolarVisita(store, 'v2')
    let primera = true
    const { sb } = sbFalso((fn) => {
      if (fn === 'ronda_registrar_visita' && primera) { primera = false; return true }
      return false
    })
    const r = await pushOutboxPorGrupo(sb, store, registry)
    expect(r.gruposDetenidos).toEqual(['v1'])
    expect(r.pushed).toBe(3)   // las tres de v2
  })
})
