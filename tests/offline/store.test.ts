import { describe, it, expect } from 'vitest'
import { InMemoryStore } from '../../packages/offline/src/store'

describe('InMemoryStore', () => {
  it('bulkPut inserta y luego actualiza por id (upsert)', async () => {
    const s = new InMemoryStore()
    await s.bulkPut('productos', [{ id: 'a', nombre: 'Jabón' }, { id: 'b', nombre: 'Escoba' }])
    expect(await s.count('productos')).toBe(2)

    await s.bulkPut('productos', [{ id: 'a', nombre: 'Jabón líquido' }])
    expect(await s.count('productos')).toBe(2)
    expect((await s.get('productos', 'a'))?.nombre).toBe('Jabón líquido')
  })

  it('aísla las tablas entre sí', async () => {
    const s = new InMemoryStore()
    await s.bulkPut('productos', [{ id: 'a' }])
    await s.bulkPut('sedes', [{ id: 'a' }, { id: 'b' }])
    expect(await s.count('productos')).toBe(1)
    expect(await s.count('sedes')).toBe(2)
  })

  it('devuelve undefined / 0 para tablas o ids inexistentes', async () => {
    const s = new InMemoryStore()
    expect(await s.get('productos', 'no-existe')).toBeUndefined()
    expect(await s.count('vacia')).toBe(0)
    expect(await s.getAll('vacia')).toEqual([])
  })

  it('guarda y lee metadatos (watermarks)', async () => {
    const s = new InMemoryStore()
    expect(await s.getMeta('wm:productos')).toBeUndefined()
    await s.setMeta('wm:productos', '2026-01-01T00:00:00.000Z')
    expect(await s.getMeta('wm:productos')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('el outbox conserva el orden y elimina por id', async () => {
    const s = new InMemoryStore()
    await s.addOutbox({ id: '1', kind: 'a', payload: {}, ts: 't' })
    await s.addOutbox({ id: '2', kind: 'b', payload: {}, ts: 't' })
    expect((await s.getOutbox()).map((o) => o.id)).toEqual(['1', '2'])

    await s.removeOutbox('1')
    expect((await s.getOutbox()).map((o) => o.id)).toEqual(['2'])
  })

  it('getOutbox devuelve una copia: mutarla no afecta al store', async () => {
    const s = new InMemoryStore()
    await s.addOutbox({ id: '1', kind: 'a', payload: {}, ts: 't' })
    const lista = await s.getOutbox()
    lista.pop()
    expect(await s.getOutbox()).toHaveLength(1)
  })
})
