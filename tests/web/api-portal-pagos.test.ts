import { describe, it, expect, beforeEach, vi } from 'vitest'

// Estado del doble de Supabase (hoisted: vi.mock se eleva por encima del módulo).
const db = vi.hoisted(() => ({
  uid: null as string | null,
  cobro: null as Record<string, unknown> | null,
  metodo: null as Record<string, unknown> | null,
  insertados: [] as { tabla: string; payload: Record<string, unknown> }[],
  errorInsert: null as { message: string } | null,
}))

vi.mock('@/lib/supabase/admin', () => ({
  uidDesdeToken: async (auth: string | null) => (auth ? db.uid : null),
  getAdmin: () => ({
    from(tabla: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: tabla === 'cobros_servicio_hogar' ? db.cobro : db.metodo,
              error: null,
            }),
          }),
        }),
        insert(payload: Record<string, unknown>) {
          db.insertados.push({ tabla, payload })
          return {
            select: () => ({
              single: async () =>
                db.errorInsert
                  ? { data: null, error: db.errorInsert }
                  : { data: { id: 'pago-1' }, error: null },
            }),
          }
        },
      }
    },
  }),
}))

const { POST } = await import('@/app/api/portal/pagos/route')

const UID = 'cliente-1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pedir(body: Record<string, unknown>, autenticado = true): any {
  return {
    headers: { get: () => (autenticado ? 'Bearer token' : null) },
    json: async () => body,
  }
}

const pagoValido = {
  cobro_id: 'cobro-1',
  metodo_id: 'metodo-1',
  monto: 50000,
}

beforeEach(() => {
  // La ruta registra los errores esperados con console.error; no ensuciamos la salida.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.uid = UID
  db.cobro = { id: 'cobro-1', cliente_id: UID, estado: 'EMITIDO', saldo: 100000, numero: 'CC-001' }
  db.metodo = {
    id: 'metodo-1', nombre: 'Transferencia', tipo: 'TRANSFERENCIA',
    activo: true, visible_cliente: true, requiere_comprobante: false, requiere_referencia: false,
  }
  db.insertados = []
  db.errorInsert = null
})

describe('POST /api/portal/pagos', () => {
  it('rechaza a quien no está autenticado', async () => {
    const res = await POST(pedir(pagoValido, false))
    expect(res.status).toBe(401)
  })

  it('exige cobro, método y monto', async () => {
    for (const body of [
      {},
      { metodo_id: 'm', monto: 1000 },
      { cobro_id: 'c', monto: 1000 },
      { cobro_id: 'c', metodo_id: 'm' },
    ]) {
      const res = await POST(pedir(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('rechaza montos cero o negativos', async () => {
    for (const monto of [0, -1000, 'abc']) {
      const res = await POST(pedir({ ...pagoValido, monto }))
      expect(res.status, String(monto)).toBe(400)
    }
  })

  it('no deja pagar la cuenta de cobro de otro cliente', async () => {
    db.cobro = { id: 'cobro-1', cliente_id: 'otro-cliente', estado: 'EMITIDO', saldo: 100000 }
    const res = await POST(pedir(pagoValido))
    expect(res.status).toBe(404)
    expect(db.insertados).toHaveLength(0)
  })

  it('devuelve 404 si la cuenta de cobro no existe', async () => {
    db.cobro = null
    const res = await POST(pedir(pagoValido))
    expect(res.status).toBe(404)
  })

  it('solo admite pagos sobre cobros EMITIDO o PARCIAL', async () => {
    for (const estado of ['BORRADOR', 'PAGADO', 'ANULADO']) {
      db.cobro = { id: 'cobro-1', cliente_id: UID, estado, saldo: 100000 }
      const res = await POST(pedir(pagoValido))
      expect(res.status, estado).toBe(409)
    }

    db.cobro = { id: 'cobro-1', cliente_id: UID, estado: 'PARCIAL', saldo: 100000 }
    expect((await POST(pedir(pagoValido))).status).toBe(200)
  })

  it('no deja pagar más que el saldo pendiente', async () => {
    const res = await POST(pedir({ ...pagoValido, monto: 100001 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('saldo')
  })

  it('acepta pagar exactamente el saldo', async () => {
    expect((await POST(pedir({ ...pagoValido, monto: 100000 }))).status).toBe(200)
  })

  it('rechaza formas de pago inactivas u ocultas al cliente', async () => {
    for (const parche of [{ activo: false }, { visible_cliente: false }]) {
      db.metodo = { ...db.metodo, ...parche }
      const res = await POST(pedir(pagoValido))
      expect(res.status, JSON.stringify(parche)).toBe(400)
    }

    db.metodo = null
    expect((await POST(pedir(pagoValido))).status).toBe(400)
  })

  it('exige la referencia cuando la forma de pago la pide', async () => {
    db.metodo = { ...db.metodo, requiere_referencia: true }
    expect((await POST(pedir(pagoValido))).status).toBe(400)
    expect((await POST(pedir({ ...pagoValido, referencia: '123456' }))).status).toBe(200)
  })

  it('exige el comprobante cuando la forma de pago lo pide', async () => {
    db.metodo = { ...db.metodo, requiere_comprobante: true }
    expect((await POST(pedir(pagoValido))).status).toBe(400)
    const ok = await POST(pedir({ ...pagoValido, comprobante_path: `${UID}/soporte.jpg` }))
    expect(ok.status).toBe(200)
  })

  it('no acepta comprobantes guardados en la carpeta de otro cliente', async () => {
    const res = await POST(pedir({ ...pagoValido, comprobante_path: 'otro-cliente/soporte.jpg' }))
    expect(res.status).toBe(400)
    expect(db.insertados).toHaveLength(0)
  })

  it('registra el pago como reportado por el cliente', async () => {
    const res = await POST(pedir({ ...pagoValido, referencia: 'REF-9' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: 'pago-1' })
    expect(db.insertados).toHaveLength(1)
    expect(db.insertados[0].tabla).toBe('pagos_hogar')
    expect(db.insertados[0].payload).toMatchObject({
      cobro_id: 'cobro-1',
      cliente_id: UID,          // se toma del token, nunca del cuerpo de la petición
      metodo_id: 'metodo-1',
      metodo_nombre: 'Transferencia',
      monto: 50000,
      referencia: 'REF-9',
      origen: 'CLIENTE',
      estado: 'REPORTADO',      // el pago nace sin confirmar: lo verifica la empresa
    })
  })

  it('ignora un cliente_id enviado por el navegador', async () => {
    await POST(pedir({ ...pagoValido, cliente_id: 'cliente-suplantado' }))
    expect(db.insertados[0].payload.cliente_id).toBe(UID)
  })

  it('si la base falla devuelve 500 y no finge que se guardó', async () => {
    db.errorInsert = { message: 'duplicate key' }
    const res = await POST(pedir(pagoValido))
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBeUndefined()
  })
})
