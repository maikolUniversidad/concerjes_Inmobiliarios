import { describe, it, expect, beforeEach, vi } from 'vitest'

// Doble de Supabase con lo que usa la server action de cargas masivas.
const db = vi.hoisted(() => {
  interface Escritura { op: 'insert' | 'update'; tabla: string; payload: Record<string, unknown>; id?: unknown }
  const estado = {
    usuario: { id: 'u1', email: 'admin@conserjes.co' } as { id: string; email: string } | null,
    /** tabla → filas existentes */
    filas: {} as Record<string, Record<string, unknown>[]>,
    escrituras: [] as Escritura[],
    /** tabla → mensaje de error a devolver */
    fallar: {} as Record<string, string>,
    /** consultas de búsqueda, para verificar eq vs ilike */
    busquedas: [] as { tabla: string; operador: string; columna: string; valor: unknown }[],
  }

  class Q {
    private op: 'select' | 'insert' | 'update' = 'select'
    private filtros: { operador: string; columna: string; valor: unknown }[] = []
    private payload: Record<string, unknown> = {}
    constructor(private tabla: string) {}

    select() { return this }
    limit() { return this }
    order() { return this }
    eq(columna: string, valor: unknown) { this.filtros.push({ operador: 'eq', columna, valor }); return this }
    ilike(columna: string, valor: unknown) { this.filtros.push({ operador: 'ilike', columna, valor }); return this }
    is() { return this }
    update(payload: Record<string, unknown>) { this.op = 'update'; this.payload = payload; return this }
    insert(payload: Record<string, unknown>) { this.op = 'insert'; this.payload = payload; return this }
    maybeSingle() { return Promise.resolve(this.correr()) }
    single() { return Promise.resolve(this.correr()) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(f: (v: any) => unknown, r?: (e: unknown) => unknown) {
      return Promise.resolve(this.correr()).then(f, r)
    }

    private correr() {
      const msg = estado.fallar[this.tabla]
      if (msg) return { data: null, error: { message: msg } }

      if (this.op === 'select') {
        for (const f of this.filtros) {
          estado.busquedas.push({ tabla: this.tabla, operador: f.operador, columna: f.columna, valor: f.valor })
        }
        const filas = estado.filas[this.tabla] ?? []
        const encontrada = filas.find((fila) =>
          this.filtros.every((f) => f.operador === 'ilike'
            ? String(fila[f.columna] ?? '').toLowerCase() === String(f.valor).toLowerCase()
            : fila[f.columna] === f.valor))
        return { data: encontrada ?? null, error: null }
      }

      const id = this.filtros.find((f) => f.columna === 'id')?.valor
      estado.escrituras.push({ op: this.op, tabla: this.tabla, payload: this.payload, id })
      return { data: { id: (this.payload.id as string) ?? 'nuevo-id' }, error: null }
    }
  }

  const cliente = {
    auth: { getUser: async () => ({ data: { user: estado.usuario } }) },
    from: (tabla: string) => new Q(tabla),
  }

  // Se devuelve el MISMO objeto (no una copia) para que lo que ajusten las
  // pruebas sea lo que lee el doble de Supabase.
  return Object.assign(estado, { cliente })
})

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db.cliente }))
vi.mock('@/lib/activity', () => ({ logActivity: async () => {} }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.cliente }))

const { importarEntidad } = await import('@/app/(dashboard)/importar/actions')

/** Escrituras reales sobre una tabla (sin contar el registro del lote). */
const escrituras = (tabla: string) => db.escrituras.filter((e) => e.tabla === tabla)

beforeEach(() => {
  db.usuario = { id: 'u1', email: 'admin@conserjes.co' }
  db.filas = {}
  db.escrituras = []
  db.fallar = {}
  db.busquedas = []
})

describe('importarEntidad — no pisar datos al actualizar', () => {
  it('un Excel de dos columnas actualiza solo esas dos', async () => {
    // Regresión: se enviaban TODAS las columnas con null, así que actualizar el
    // precio borraba presentación, complemento y ponía tipo_insumo = OTROS.
    db.filas.productos = [{ id: 'p1', ref: 1001 }]

    const res = await importarEntidad('productos', [
      { fila: 2, clave: 'ref=1001', datos: { ref: 1001, precio_lista: 18900 } },
    ], 'precios.xlsx')

    expect(res.actualizados).toBe(1)
    const update = escrituras('productos')[0]
    expect(update.op).toBe('update')
    expect(update.id).toBe('p1')
    expect(Object.keys(update.payload).sort()).toEqual(['precio_lista', 'ref'])
    expect(update.payload).not.toHaveProperty('tipo_insumo')
    expect(update.payload).not.toHaveProperty('presentacion')
  })

  it('crear un producto sí aplica los valores por defecto', async () => {
    const res = await importarEntidad('productos', [
      { fila: 2, clave: 'nombre', datos: { nombre_estandar: 'JABON', precio_lista: 18900 } },
    ], 'nuevos.xlsx')

    expect(res.creados).toBe(1)
    const insert = escrituras('productos')[0]
    expect(insert.op).toBe('insert')
    expect(insert.payload).toMatchObject({
      nombre_estandar: 'JABON', precio_lista: 18900,
      tipo_insumo: 'OTROS', cat_rotacion: 'C', stock_minimo_def: 0,
    })
  })

  it('el producto nuevo estrena su fila de stock', async () => {
    await importarEntidad('productos', [
      { fila: 2, clave: 'x', datos: { nombre_estandar: 'JABON', stock_inicial: 120 } },
    ], 'a.xlsx')

    expect(escrituras('stock')[0].payload).toMatchObject({ cantidad_real: 120, cantidad_disp: 120 })
  })

  it('actualizar un proveedor no le apaga la marca de principal', async () => {
    db.filas.proveedores = [{ id: 'pr1', nit: '900123456-7' }]

    await importarEntidad('proveedores', [
      { fila: 2, clave: 'nit', datos: { nit: '900123456-7', telefono: '3001112233' } },
    ], 'a.xlsx')

    expect(escrituras('proveedores')[0].payload).not.toHaveProperty('es_principal')
  })

  it('un proveedor nuevo entra como no principal', async () => {
    await importarEntidad('proveedores', [
      { fila: 2, clave: 'nombre', datos: { nombre: 'DETALGRAF' } },
    ], 'a.xlsx')

    expect(escrituras('proveedores')[0].payload).toMatchObject({ nombre: 'DETALGRAF', es_principal: false })
  })

  it('si el archivo dice es_principal = NO, se guarda como false', async () => {
    await importarEntidad('proveedores', [
      { fila: 2, clave: 'nombre', datos: { nombre: 'X', es_principal: false } },
    ], 'a.xlsx')

    expect(escrituras('proveedores')[0].payload.es_principal).toBe(false)
  })

  it('una fila sin nada que cambiar no dispara un UPDATE vacío', async () => {
    db.filas.productos = [{ id: 'p1', ref: 1001 }]

    const res = await importarEntidad('productos', [
      { fila: 2, clave: 'ref=1001', datos: { stock_inicial: 5 } },  // stock_inicial no se actualiza
    ], 'a.xlsx')

    expect(res.actualizados + res.creados).toBe(1)
    expect(escrituras('productos').filter(e => e.op === 'update')).toHaveLength(0)
  })
})

describe('importarEntidad — búsqueda de existentes', () => {
  it('las claves de texto se buscan sin distinguir mayúsculas', async () => {
    db.filas.proveedores = [{ id: 'pr1', nombre: 'Detalgraf S.A.S' }]

    const res = await importarEntidad('proveedores', [
      { fila: 2, clave: 'nombre', datos: { nombre: 'DETALGRAF S.A.S' } },
    ], 'a.xlsx')

    expect(res.actualizados).toBe(1)   // antes creaba un proveedor duplicado
    expect(db.busquedas.some(b => b.operador === 'ilike' && b.columna === 'nombre')).toBe(true)
  })

  it('las claves numéricas se buscan por igualdad exacta', async () => {
    await importarEntidad('productos', [
      { fila: 2, clave: 'ref=1001', datos: { ref: 1001, nombre_estandar: 'X' } },
    ], 'a.xlsx')

    expect(db.busquedas.find(b => b.columna === 'ref')?.operador).toBe('eq')
  })
})

describe('importarEntidad — defensa del servidor', () => {
  it('descarta campos que no son columnas de la plantilla', async () => {
    await importarEntidad('productos', [
      { fila: 2, clave: 'x', datos: { nombre_estandar: 'JABON', rol: 'SUPER_ADMIN', activo: true } },
    ], 'a.xlsx')

    const payload = escrituras('productos')[0].payload
    expect(payload).not.toHaveProperty('rol')
    expect(payload).not.toHaveProperty('activo')
  })

  it('no procesa dos veces la misma clave aunque el navegador la mande repetida', async () => {
    const res = await importarEntidad('productos', [
      { fila: 2, clave: 'ref=1001', datos: { ref: 1001, nombre_estandar: 'JABON' } },
      { fila: 3, clave: 'ref=1001', datos: { ref: 1001, nombre_estandar: 'JABON BIS' } },
    ], 'a.xlsx')

    expect(res.creados).toBe(1)
    expect(res.errores).toBe(1)
    expect(res.detalle[1].error).toContain('repetida')
    expect(escrituras('productos')).toHaveLength(1)
  })

  it('exige sesión iniciada', async () => {
    db.usuario = null
    const res = await importarEntidad('productos', [{ fila: 2, clave: 'x', datos: { nombre_estandar: 'A' } }], 'a.xlsx')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('sesión')
  })

  it('rechaza entidades que no existen', async () => {
    const res = await importarEntidad('inventado', [], 'a.xlsx')
    expect(res.ok).toBe(false)
  })

  it('pone un tope al tamaño del lote', async () => {
    const filas = Array.from({ length: 2001 }, (_, i) => ({
      fila: i + 2, clave: `x${i}`, datos: { nombre_estandar: `P${i}` },
    }))
    const res = await importarEntidad('productos', filas, 'a.xlsx')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('2000')
  })
})

describe('importarEntidad — resultado', () => {
  it('un error en una fila no detiene las demás y el conteo cuadra', async () => {
    db.filas.grupos_contrato = [{ id: 'g1', codigo: 'CA' }]

    const res = await importarEntidad('sedes', [
      { fila: 2, clave: 'a', datos: { grupo: 'CA', nombre: 'Portal Norte' } },
      { fila: 3, clave: 'b', datos: { grupo: 'ZZ', nombre: 'Sede Rara' } },   // grupo inexistente
      { fila: 4, clave: 'c', datos: { grupo: 'CA', nombre: 'Portal Sur' } },
    ], 'sedes.xlsx')

    expect(res).toMatchObject({ ok: true, total: 3, creados: 2, errores: 1 })
    expect(res.detalle[1].accion).toBe('error')
    expect(res.detalle[1].error).toContain('ZZ')
  })

  it('crear una sede sin grupo es un error explícito', async () => {
    const res = await importarEntidad('sedes', [
      { fila: 2, clave: 'a', datos: { nombre: 'Sin grupo' } },
    ], 'a.xlsx')

    expect(res.errores).toBe(1)
    expect(res.detalle[0].error).toContain('grupo')
  })

  it('actualizar una sede sin la columna grupo no le cambia el grupo', async () => {
    db.filas.sedes = [{ id: 's1', codigo_interno: 'CA-001' }]

    await importarEntidad('sedes', [
      { fila: 2, clave: 'CA-001', datos: { codigo_interno: 'CA-001', zona: 'Norte' } },
    ], 'a.xlsx')

    expect(escrituras('sedes')[0].payload).not.toHaveProperty('grupo_id')
  })

  it('traduce los errores técnicos de la base a algo entendible', async () => {
    db.fallar.productos = 'new row violates row-level security policy'
    const res = await importarEntidad('productos', [
      { fila: 2, clave: 'x', datos: { nombre_estandar: 'A' } },
    ], 'a.xlsx')

    expect(res.detalle[0].error).toBe('Sin permisos para esta entidad.')
  })

  it('deja registrado el lote en el historial de importaciones', async () => {
    await importarEntidad('productos', [
      { fila: 2, clave: 'x', datos: { nombre_estandar: 'A' } },
    ], 'maestro.xlsx')

    const registro = escrituras('importaciones')[0]
    expect(registro.payload).toMatchObject({
      entidad: 'productos', archivo_nombre: 'maestro.xlsx', total: 1, creados: 1,
      usuario_id: 'u1', usuario_email: 'admin@conserjes.co',
    })
  })
})
