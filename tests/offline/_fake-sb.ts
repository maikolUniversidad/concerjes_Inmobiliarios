// Doble de prueba del cliente Supabase: implementa solo lo que usa el motor
// offline (from().select().gt().order().limit(), upsert, update().eq(), rpc).
import type { Row, Sb } from '../../packages/offline/src/types'

export interface Escritura {
  op: 'upsert' | 'update'
  tabla: string
  payload: Record<string, unknown>
  id?: unknown
}

export class FakeSb implements Sb {
  datos: Record<string, Row[]> = {}
  escrituras: Escritura[] = []
  rpcs: { fn: string; args?: Record<string, unknown> }[] = []
  /** tabla o nombre de rpc → mensaje de error a devolver. */
  fallar: Record<string, string> = {}

  from(tabla: string): FakeQuery {
    return new FakeQuery(this, tabla)
  }

  async rpc(fn: string, args?: Record<string, unknown>) {
    this.rpcs.push({ fn, args })
    const msg = this.fallar[fn]
    return { data: null, error: msg ? { message: msg } : null }
  }
}

class FakeQuery {
  private op: 'select' | 'upsert' | 'update' = 'select'
  private col = ''
  private wm: string | null = null
  private lim = Number.POSITIVE_INFINITY
  private payload: Record<string, unknown> = {}
  private eqVal: unknown = null

  constructor(private sb: FakeSb, private tabla: string) {}

  select() { this.op = 'select'; return this }
  gt(col: string, v: string) { this.col = col; this.wm = v; return this }
  order(col: string) { if (!this.col) this.col = col; return this }
  limit(n: number) { this.lim = n; return this }
  upsert(payload: Record<string, unknown>) { this.op = 'upsert'; this.payload = payload; return this }
  update(payload: Record<string, unknown>) { this.op = 'update'; this.payload = payload; return this }
  eq(_col: string, val: unknown) { this.eqVal = val; return this }

  private ejecutar() {
    const msg = this.sb.fallar[this.tabla]
    if (msg) return { data: null, error: { message: msg } }

    if (this.op === 'select') {
      let filas = [...(this.sb.datos[this.tabla] ?? [])]
      if (this.wm !== null) filas = filas.filter((f) => String(f[this.col]) > this.wm!)
      filas.sort((a, b) => String(a[this.col]).localeCompare(String(b[this.col])))
      return { data: filas.slice(0, this.lim), error: null }
    }

    this.sb.escrituras.push({ op: this.op, tabla: this.tabla, payload: this.payload, id: this.eqVal })
    return { data: null, error: null }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(onF: (v: any) => unknown, onR?: (e: unknown) => unknown) {
    return Promise.resolve(this.ejecutar()).then(onF, onR)
  }
}

/** Genera n filas con watermark creciente (1 segundo entre cada una). */
export function filas(n: number, col = 'updated_at', desde = Date.UTC(2026, 0, 1)): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(5, '0')}`,
    [col]: new Date(desde + i * 1000).toISOString(),
  }))
}
