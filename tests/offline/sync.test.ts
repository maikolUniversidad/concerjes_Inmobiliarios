import { describe, it, expect } from 'vitest'
import { InMemoryStore } from '../../packages/offline/src/store'
import { PushRegistry, upsertHandler, encolar } from '../../packages/offline/src/outbox'
import { pullTabla, pushOutbox, sincronizar } from '../../packages/offline/src/sync'
import { FakeSb, filas } from './_fake-sb'

describe('pullTabla', () => {
  it('trae todo la primera vez y avanza el watermark', async () => {
    const sb = new FakeSb()
    sb.datos.productos = filas(3)
    const store = new InMemoryStore()

    const n = await pullTabla(sb, store, { tabla: 'productos', modo: 'incremental' })

    expect(n).toBe(3)
    expect(await store.count('productos')).toBe(3)
    expect(await store.getMeta('wm:productos')).toBe(sb.datos.productos[2].updated_at)
  })

  it('la segunda sincronizacion no vuelve a bajar lo mismo', async () => {
    const sb = new FakeSb()
    sb.datos.productos = filas(3)
    const store = new InMemoryStore()
    const def = { tabla: 'productos', modo: 'incremental' as const }

    await pullTabla(sb, store, def)
    expect(await pullTabla(sb, store, def)).toBe(0)
  })

  it('trae solo lo modificado despues del watermark', async () => {
    const sb = new FakeSb()
    sb.datos.productos = filas(3)
    const store = new InMemoryStore()
    const def = { tabla: 'productos', modo: 'incremental' as const }
    await pullTabla(sb, store, def)

    sb.datos.productos.push({ id: 'nuevo', updated_at: '2027-01-01T00:00:00.000Z' })
    expect(await pullTabla(sb, store, def)).toBe(1)
    expect(await store.count('productos')).toBe(4)
  })

  it('pagina cuando hay mas de 1000 filas', async () => {
    const sb = new FakeSb()
    sb.datos.productos = filas(1500)
    const store = new InMemoryStore()

    const n = await pullTabla(sb, store, { tabla: 'productos', modo: 'incremental' })

    expect(n).toBe(1500)
    expect(await store.count('productos')).toBe(1500)
  })

  it('en modo append usa created_at como watermark', async () => {
    const sb = new FakeSb()
    sb.datos.movimientos = filas(2, 'created_at')
    const store = new InMemoryStore()

    await pullTabla(sb, store, { tabla: 'movimientos', modo: 'append', tsCol: 'created_at' })

    expect(await store.getMeta('wm:movimientos')).toBe(sb.datos.movimientos[1].created_at)
  })

  it('en modo full no guarda watermark y siempre baja todo', async () => {
    const sb = new FakeSb()
    sb.datos.bancos = [{ id: '1' }, { id: '2' }]
    const store = new InMemoryStore()
    const def = { tabla: 'bancos', modo: 'full' as const }

    expect(await pullTabla(sb, store, def)).toBe(2)
    expect(await store.getMeta('wm:bancos')).toBeUndefined()
    expect(await pullTabla(sb, store, def)).toBe(2)
  })

  it('propaga el error indicando la tabla', async () => {
    const sb = new FakeSb()
    sb.fallar.productos = 'permission denied'
    await expect(
      pullTabla(sb, new InMemoryStore(), { tabla: 'productos', modo: 'incremental' }),
    ).rejects.toThrow('productos: permission denied')
  })
})

describe('pushOutbox', () => {
  it('sube cada pendiente y lo saca de la cola', async () => {
    const sb = new FakeSb()
    const store = new InMemoryStore()
    const reg = new PushRegistry().on('upsert:productos', upsertHandler('productos'))
    await encolar(store, 'upsert:productos', { id: 'a', nombre: 'Jabon' })

    const res = await pushOutbox(sb, store, reg)

    expect(res).toEqual({ pushed: 1, errores: [] })
    expect(await store.getOutbox()).toHaveLength(0)
    expect(sb.escrituras).toEqual([
      { op: 'upsert', tabla: 'productos', payload: { id: 'a', nombre: 'Jabon' }, id: null },
    ])
  })

  it('si el servidor falla deja el pendiente para reintentar', async () => {
    const sb = new FakeSb()
    sb.fallar.productos = 'sin conexion'
    const store = new InMemoryStore()
    const reg = new PushRegistry().on('upsert:productos', upsertHandler('productos'))
    await encolar(store, 'upsert:productos', { id: 'a' })

    const res = await pushOutbox(sb, store, reg)

    expect(res.pushed).toBe(0)
    expect(res.errores[0]).toContain('sin conexion')
    expect(await store.getOutbox()).toHaveLength(1)
  })

  it('un pendiente sin manejador no bloquea a los demas', async () => {
    const sb = new FakeSb()
    const store = new InMemoryStore()
    const reg = new PushRegistry().on('upsert:productos', upsertHandler('productos'))
    await encolar(store, 'kind-desconocido', {})
    await encolar(store, 'upsert:productos', { id: 'a' })

    const res = await pushOutbox(sb, store, reg)

    expect(res.pushed).toBe(1)
    expect(res.errores).toEqual(['Sin manejador para "kind-desconocido"'])
    expect(await store.getOutbox()).toHaveLength(1)
  })
})

describe('sincronizar', () => {
  it('primero sube lo pendiente y luego baja lo nuevo', async () => {
    const sb = new FakeSb()
    sb.datos.productos = filas(2)
    const store = new InMemoryStore()
    const reg = new PushRegistry().on('upsert:productos', upsertHandler('productos'))
    await encolar(store, 'upsert:productos', { id: 'local' })

    const res = await sincronizar(sb, store, reg)

    expect(res.pushed).toBe(1)
    expect(res.errores).toEqual([])
    expect(res.pulled.productos).toBe(2)
    expect(Object.keys(res.pulled)).toContain('movimientos')
  })
})
