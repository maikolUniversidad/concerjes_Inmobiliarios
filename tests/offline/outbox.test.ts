import { describe, it, expect } from 'vitest'
import { InMemoryStore } from '../../packages/offline/src/store'
import {
  encolar, PushRegistry, upsertHandler, rpcHandler, updateHandler,
} from '../../packages/offline/src/outbox'
import { FakeSb } from './_fake-sb'

describe('encolar', () => {
  it('escribe optimista en el store y deja el intent pendiente', async () => {
    const store = new InMemoryStore()
    await encolar(store, 'upsert:productos', { id: 'a', nombre: 'Jabon' }, {
      tabla: 'productos', row: { id: 'a', nombre: 'Jabon' },
    })

    expect(await store.get('productos', 'a')).toEqual({ id: 'a', nombre: 'Jabon' })
    const cola = await store.getOutbox()
    expect(cola).toHaveLength(1)
    expect(cola[0].kind).toBe('upsert:productos')
    expect(cola[0].intentos).toBe(0)
    expect(Number.isNaN(Date.parse(cola[0].ts))).toBe(false)
  })

  it('sin escritura optimista solo encola', async () => {
    const store = new InMemoryStore()
    await encolar(store, 'movimiento', { cantidad: 3 })
    expect(await store.count('productos')).toBe(0)
    expect(await store.getOutbox()).toHaveLength(1)
  })

  it('cada intent recibe un id distinto', async () => {
    const store = new InMemoryStore()
    await encolar(store, 'a', {})
    await encolar(store, 'a', {})
    const [x, y] = await store.getOutbox()
    expect(x.id).not.toBe(y.id)
  })
})

describe('PushRegistry', () => {
  it('registra y devuelve manejadores por tipo', () => {
    const h = upsertHandler('productos')
    const reg = new PushRegistry().on('upsert:productos', h)
    expect(reg.get('upsert:productos')).toBe(h)
    expect(reg.get('otro')).toBeUndefined()
  })
})

describe('manejadores genericos', () => {
  it('upsertHandler manda el payload completo', async () => {
    const sb = new FakeSb()
    await upsertHandler('productos')(sb, { id: 'a', nombre: 'X' })
    expect(sb.escrituras[0]).toMatchObject({ op: 'upsert', tabla: 'productos' })
  })

  it('updateHandler filtra por id y no lo manda dentro del SET', async () => {
    const sb = new FakeSb()
    await updateHandler('productos')(sb, { id: 'a', nombre: 'X' })
    expect(sb.escrituras[0]).toEqual({
      op: 'update', tabla: 'productos', payload: { nombre: 'X' }, id: 'a',
    })
  })

  it('rpcHandler llama la funcion con sus argumentos', async () => {
    const sb = new FakeSb()
    await rpcHandler('registrar_movimiento')(sb, { cantidad: 2 })
    expect(sb.rpcs).toEqual([{ fn: 'registrar_movimiento', args: { cantidad: 2 } }])
  })

  it('los manejadores lanzan con el mensaje del servidor', async () => {
    const sb = new FakeSb()
    sb.fallar.productos = 'violates row-level security'
    await expect(upsertHandler('productos')(sb, { id: 'a' })).rejects.toThrow('violates row-level security')

    sb.fallar.registrar_movimiento = 'stock insuficiente'
    await expect(rpcHandler('registrar_movimiento')(sb, {})).rejects.toThrow('stock insuficiente')
  })
})
