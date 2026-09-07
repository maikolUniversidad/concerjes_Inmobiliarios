import { describe, it, expect } from 'vitest'
import { INFORMES, GRUPOS_INFORME } from '@/lib/reportes/informes'

// Cliente de Supabase de mentiras: devuelve filas fijas por tabla e ignora los
// filtros/orden, que es todo lo que el informe necesita para armar las hojas.
type Fila = Record<string, unknown>

function supabaseFalso(tablas: Record<string, Fila[]>) {
  const constructor = (tabla: string) => {
    let servido = false
    const q: Record<string, unknown> = {}
    // Cada método encadenable devuelve el mismo objeto; el `await` final lo
    // resuelve con las filas de la tabla (una sola vez, para cortar el paginado).
    for (const m of ['select', 'eq', 'in', 'order', 'range']) {
      q[m] = () => q
    }
    q.then = (resolver: (v: { data: Fila[]; error: null }) => unknown) => {
      const data = servido ? [] : (tablas[tabla] ?? [])
      servido = true
      return Promise.resolve(resolver({ data, error: null }))
    }
    return q
  }
  return { from: constructor }
}

const PRODUCTO = {
  id: 'p1', ref: 10, codigo: 500, sku: 'SKU-1', codigo_barras: '7700001',
  nombre_estandar: 'Jabón líquido', presentacion: 'Garrafa 5L', complemento: null,
  tipo_insumo: 'ASEO', cat_rotacion: 'A', stock_minimo_def: 5, stock_minimo_asig: 0,
  stock_min_suger: 0, ind_rot_general: null, ind_rot_mes: null,
  precio_lista: 20000, precio_lista2: null, ubicacion_bodega: null, bodega_descripcion: null,
  activo: true, inventario_periodo: null, inventario_encontrado: null, inventario_fecha: null,
  created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z',
  stock: { cantidad_real: 30, cantidad_disp: 30, cantidad_entr: 0, cantidad_sal: 0 },
  proveedor: null, proveedor2: null, ubicacion: null,
}

const SEDE_NORTE = { nombre: 'Torre Norte', ciudad: 'BOGOTÁ D.C.', grupo: { codigo: 'C-100' } }

const MOVIMIENTOS = [
  {
    id: 'm1', tipo: 'SALIDA', cantidad: 4, observacion: 'Pedido semanal',
    created_at: '2026-03-10T14:30:00Z', usuario_id: 'u1', producto_id: 'p1',
    producto: PRODUCTO, sede: SEDE_NORTE,
  },
  {
    id: 'm2', tipo: 'DEVOLUCION', cantidad: 1, observacion: 'Envase dañado',
    created_at: '2026-03-09T09:00:00Z', usuario_id: 'u1', producto_id: 'p1',
    producto: PRODUCTO, sede: SEDE_NORTE,
  },
  {
    id: 'm3', tipo: 'ENTRADA', cantidad: 20, observacion: 'Compra OC-99',
    created_at: '2026-03-01T08:00:00Z', usuario_id: 'u2', producto_id: 'p1',
    producto: PRODUCTO, sede: null,
  },
  {
    // Producto que ya no está en el catálogo: los datos salen del movimiento.
    id: 'm4', tipo: 'SALIDA', cantidad: 2, observacion: '', created_at: '2026-02-20T16:00:00Z',
    usuario_id: null, producto_id: 'p-viejo',
    producto: { ref: 99, codigo: 900, sku: null, nombre_estandar: 'Trapero retirado', presentacion: null },
    sede: { nombre: 'Sede Sur', ciudad: 'CALI', grupo: null },
  },
]

const USUARIOS = [{ id: 'u1', nombre: 'Ana Ruiz' }, { id: 'u2', nombre: 'Luis Páez' }]

const informe = INFORMES.find(i => i.id === 'seguimiento-productos')!

async function generar() {
  const supabase = supabaseFalso({
    movimientos: MOVIMIENTOS,
    productos: [PRODUCTO],
    usuarios_opciones: USUARIOS,
  })
  return informe.generar(supabase, () => {})
}

describe('catálogo de informes', () => {
  it('publica el seguimiento de productos en el módulo de reportes', () => {
    expect(informe).toBeDefined()
    expect(informe.nombre).toContain('Seguimiento de productos')
    expect(GRUPOS_INFORME).toContain(informe.grupo)
  })

  it('no repite identificadores ni nombres de archivo', () => {
    expect(new Set(INFORMES.map(i => i.id)).size).toBe(INFORMES.length)
    expect(new Set(INFORMES.map(i => i.archivo)).size).toBe(INFORMES.length)
  })
})

describe('informe de seguimiento de productos', () => {
  it('trae las columnas pedidas: sede, fecha y hora, código, nombre, cantidad, tipo y observaciones', async () => {
    const { hojas } = await generar()
    const headers = hojas[0].columnas.map(c => c.header)
    for (const h of ['Sede destino', 'Fecha y hora', 'Código', 'Producto', 'Cantidad enviada', 'Tipo de movimiento', 'Observaciones']) {
      expect(headers, h).toContain(h)
    }
  })

  it('arma un renglón por movimiento con su sede, producto y observación', async () => {
    const { hojas } = await generar()
    const filas = hojas[0].filas
    expect(filas).toHaveLength(4)

    const salida = filas[0]
    expect(salida.sede).toBe('Torre Norte')
    expect(salida.ciudad).toBe('BOGOTÁ D.C.')
    expect(salida.contrato).toBe('C-100')
    expect(salida.tipo_mov).toBe('Salida')
    expect(salida.cantidad).toBe(4)
    expect(salida.observacion).toBe('Pedido semanal')
    expect(salida.codigo).toBe(500)
    expect(salida.producto).toBe('Jabón líquido')
    expect(salida.responsable).toBe('Ana Ruiz')
    expect(String(salida.fecha_hora)).not.toBe('')
  })

  it('marca como bodega central los movimientos sin sede', async () => {
    const { hojas } = await generar()
    const entrada = hojas[0].filas.find(f => f.tipo_mov === 'Entrada')
    expect(entrada?.sede).toContain('sin sede')
  })

  it('conserva código y nombre de productos que ya no están en el catálogo', async () => {
    const { hojas } = await generar()
    const retirado = hojas[0].filas.find(f => f.producto === 'Trapero retirado')
    expect(retirado?.codigo).toBe(900)
    expect(retirado?.sede).toBe('Sede Sur')
  })

  it('suma por sede sólo lo enviado, y aparte lo devuelto', async () => {
    const { hojas } = await generar()
    const norte = hojas[1].filas.find(f => f.sede === 'Torre Norte')
    expect(norte?.enviadas).toBe(4)
    expect(norte?.devueltas).toBe(1)
    expect(norte?.movimientos).toBe(2)
    expect(norte?.productos).toBe(1)
  })

  it('consolida por producto con las sedes atendidas y el último envío', async () => {
    const { hojas } = await generar()
    const jabon = hojas[2].filas.find(f => f.producto === 'Jabón líquido')
    expect(jabon?.enviadas).toBe(4)
    expect(jabon?.sedes).toBe(1)
    expect(jabon?.ultima_sede).toBe('Torre Norte')
  })

  it('resume el envío total sin contar entradas ni ajustes', async () => {
    const { resumen } = await generar()
    const valor = (label: string) => resumen.find(r => r.label === label)?.valor
    expect(valor('Movimientos incluidos')).toBe(4)
    expect(valor('Unidades enviadas a sedes')).toBe('6')
    expect(valor('Unidades devueltas')).toBe('1')
    expect(valor('Sedes atendidas')).toBe(2)
    expect(valor('Movimientos sin sede asignada')).toBe(1)
  })

  it('cada fila usa llaves declaradas en las columnas de su hoja', async () => {
    const { hojas } = await generar()
    for (const hoja of hojas) {
      const llaves = new Set(hoja.columnas.map(c => c.key))
      // ExcelJS indexa las columnas por `key`: una repetida pisaría a la otra.
      expect(llaves.size, hoja.nombre).toBe(hoja.columnas.length)
      for (const f of hoja.filas) {
        for (const k of Object.keys(f)) expect(llaves, `${hoja.nombre}.${k}`).toContain(k)
      }
    }
  })
})
