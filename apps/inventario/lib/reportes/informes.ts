// Informes de inventario listos para descargar en Excel.
//
// Cada informe consulta con el cliente de navegador de Supabase (respeta RLS) y
// devuelve hojas ya organizadas: una hoja "Resumen" con los indicadores y una o
// varias hojas de detalle que siempre llevan la ficha completa del producto
// (identificación, stock, mínimos, precios, proveedor, ubicación e inventario
// físico), para que el Excel se pueda usar sin cruzar información a mano.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>

const PAGINA = 1000
const MAX_FILAS = 20000

/** Estados de una orden de insumo cuya demanda todavía NO salió de bodega. */
const ESTADOS_OI_PENDIENTES = ['EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA', 'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO']
/** Estados de OC que siguen esperando mercancía del proveedor. */
const ESTADOS_OC_ABIERTAS = ['BORRADOR', 'APROBADA', 'ENVIADA', 'PARCIAL']

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Formato = 'texto' | 'entero' | 'decimal' | 'cop'

export interface ColumnaInforme {
  header: string
  key: string
  width?: number
  formato?: Formato
  /** Suma la columna en la fila de totales al pie de la hoja. */
  total?: boolean
}

export interface HojaInforme {
  nombre: string
  columnas: ColumnaInforme[]
  filas: Fila[]
  nota?: string
  /** Pinta la fila en rojo suave (p. ej. agotados). */
  resaltar?: (f: Fila) => boolean
}

export interface ResultadoInforme {
  hojas: HojaInforme[]
  resumen: { label: string; valor: string | number }[]
  /** Supuestos del cálculo; se escriben al pie de la hoja de resumen. */
  notas?: string[]
}

export interface DefinicionInforme {
  id: string
  nombre: string
  grupo: string
  descripcion: string
  /** Qué trae el archivo (se muestra como chips en la interfaz). */
  incluye: string[]
  archivo: string
  generar: (supabase: DB, progreso: (paso: string) => void) => Promise<ResultadoInforme>
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Los embebidos de PostgREST llegan como objeto o como arreglo de uno. */
function uno<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function fecha(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fechaHora(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
}

const siNo = (v: boolean | null | undefined): string => (v === null || v === undefined ? '' : v ? 'Sí' : 'No')

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
const miles = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

// ─── Carga de productos (ficha completa) ──────────────────────────────────────

const SELECT_PRODUCTO = `
  id, ref, codigo, sku, codigo_barras, nombre_estandar, presentacion, complemento,
  tipo_insumo, cat_rotacion, stock_minimo_def, stock_minimo_asig, stock_min_suger,
  ind_rot_general, ind_rot_mes, precio_lista, precio_lista2,
  ubicacion_bodega, bodega_descripcion, activo,
  inventario_periodo, inventario_encontrado, inventario_fecha, created_at, updated_at,
  stock ( cantidad_real, cantidad_disp, cantidad_entr, cantidad_sal ),
  proveedor:proveedor_id ( nombre, telefono ),
  proveedor2:proveedor2_id ( nombre ),
  ubicacion:ubicacion_id ( codigo, nombre, bodega:bodega_id ( nombre ) )
`

export interface Prod {
  id: string
  ref: number | null
  codigo: number | null
  sku: string | null
  codigoBarras: string | null
  nombre: string
  presentacion: string | null
  complemento: string | null
  tipo: string
  cat: string
  minDef: number
  minAsig: number
  minSuger: number
  rotGeneral: number | null
  rotMes: number | null
  precio: number
  precio2: number
  proveedor: string
  proveedorTel: string
  proveedor2: string
  real: number
  disp: number
  entr: number
  sal: number
  bodega: string
  ubicacion: string
  ubicacionTexto: string
  invPeriodo: string | null
  invHallado: boolean | null
  invFecha: string | null
  activo: boolean
  creado: string
  actualizado: string
}

function mapearProducto(r: Fila): Prod {
  const s = uno<Fila>(r.stock) ?? {}
  const prov = uno<Fila>(r.proveedor)
  const prov2 = uno<Fila>(r.proveedor2)
  const ubi = uno<Fila>(r.ubicacion)
  const bod = uno<Fila>(ubi?.bodega)
  return {
    id: r.id,
    ref: r.ref ?? null,
    codigo: r.codigo ?? null,
    sku: r.sku ?? null,
    codigoBarras: r.codigo_barras ?? null,
    nombre: r.nombre_estandar ?? '',
    presentacion: r.presentacion ?? null,
    complemento: r.complemento ?? null,
    tipo: r.tipo_insumo ?? 'OTROS',
    cat: r.cat_rotacion ?? 'C',
    minDef: num(r.stock_minimo_def),
    minAsig: num(r.stock_minimo_asig),
    minSuger: num(r.stock_min_suger),
    rotGeneral: r.ind_rot_general === null || r.ind_rot_general === undefined ? null : num(r.ind_rot_general),
    rotMes: r.ind_rot_mes === null || r.ind_rot_mes === undefined ? null : num(r.ind_rot_mes),
    precio: num(r.precio_lista),
    precio2: num(r.precio_lista2),
    proveedor: prov?.nombre ?? '',
    proveedorTel: prov?.telefono ?? '',
    proveedor2: prov2?.nombre ?? '',
    real: num(s.cantidad_real),
    disp: num(s.cantidad_disp),
    entr: num(s.cantidad_entr),
    sal: num(s.cantidad_sal),
    bodega: bod?.nombre ?? '',
    ubicacion: ubi ? [ubi.codigo, ubi.nombre].filter(Boolean).join(' · ') : '',
    ubicacionTexto: [r.ubicacion_bodega, r.bodega_descripcion].filter(Boolean).join(' · '),
    invPeriodo: r.inventario_periodo ?? null,
    invHallado: r.inventario_encontrado ?? null,
    invFecha: r.inventario_fecha ?? null,
    activo: r.activo !== false,
    creado: r.created_at ?? '',
    actualizado: r.updated_at ?? '',
  }
}

async function cargarProductos(supabase: DB, soloActivos = true): Promise<Prod[]> {
  const acc: Prod[] = []
  for (let desde = 0; desde < MAX_FILAS; desde += PAGINA) {
    let q = supabase.from('productos').select(SELECT_PRODUCTO)
    if (soloActivos) q = q.eq('activo', true)
    const { data, error } = await q
      .order('tipo_insumo', { ascending: true })
      .order('nombre_estandar', { ascending: true })
      .range(desde, desde + PAGINA - 1)
    if (error) throw new Error(`No se pudieron leer los productos: ${error.message}`)
    const lote = (data ?? []) as Fila[]
    acc.push(...lote.map(mapearProducto))
    if (lote.length < PAGINA) break
  }
  return acc
}

// ─── Demanda de las sedes (órdenes de insumo sin despachar) ───────────────────

export interface ItemPedido {
  productoId: string
  orden: string
  estado: string
  sede: string
  ciudad: string
  contrato: string
  creada: string
  solicitado: number
  alistado: number
  pendiente: number
}

async function cargarPedidosPendientes(supabase: DB): Promise<ItemPedido[]> {
  const acc: ItemPedido[] = []
  for (let desde = 0; desde < MAX_FILAS; desde += PAGINA) {
    const { data, error } = await supabase
      .from('orden_insumo_items')
      .select(
        'producto_id, cantidad_solicitada, cantidad_alistada, ' +
        'orden:ordenes_insumo!inner ( numero, estado, created_at, sede:sedes ( nombre, ciudad, grupo:grupos_contrato ( codigo ) ) )',
      )
      .in('orden.estado', ESTADOS_OI_PENDIENTES)
      .order('producto_id')
      .range(desde, desde + PAGINA - 1)
    if (error) throw new Error(`No se pudieron leer las órdenes de insumo: ${error.message}`)
    const lote = (data ?? []) as Fila[]
    for (const it of lote) {
      const o = uno<Fila>(it.orden)
      if (!o) continue
      const sede = uno<Fila>(o.sede)
      const grupo = uno<Fila>(sede?.grupo)
      const solicitado = num(it.cantidad_solicitada)
      const alistado = num(it.cantidad_alistada)
      acc.push({
        productoId: it.producto_id,
        orden: o.numero ?? '',
        estado: o.estado ?? '',
        sede: sede?.nombre ?? '',
        ciudad: sede?.ciudad ?? '',
        contrato: grupo?.codigo ?? '',
        creada: o.created_at ?? '',
        solicitado,
        alistado,
        pendiente: Math.max(0, solicitado - alistado),
      })
    }
    if (lote.length < PAGINA) break
  }
  return acc
}

// ─── Compras en curso (OC abiertas) ───────────────────────────────────────────

export interface ItemOC {
  productoId: string
  oc: string
  estado: string
  proveedor: string
  emision: string
  entrega: string
  pedido: number
  recibido: number
  pendiente: number
  precio: number
}

async function cargarOCAbiertas(supabase: DB): Promise<ItemOC[]> {
  const acc: ItemOC[] = []
  for (let desde = 0; desde < MAX_FILAS; desde += PAGINA) {
    const { data, error } = await supabase
      .from('oc_items')
      .select(
        'producto_id, cantidad_ped, cantidad_rec, precio_unit, ' +
        'oc:ordenes_compra!inner ( numero_oc, estado, fecha_emision, fecha_entrega, proveedor:proveedores ( nombre ) )',
      )
      .in('oc.estado', ESTADOS_OC_ABIERTAS)
      .order('producto_id')
      .range(desde, desde + PAGINA - 1)
    if (error) throw new Error(`No se pudieron leer las órdenes de compra: ${error.message}`)
    const lote = (data ?? []) as Fila[]
    for (const it of lote) {
      const o = uno<Fila>(it.oc)
      if (!o) continue
      const pedido = num(it.cantidad_ped)
      const recibido = num(it.cantidad_rec)
      acc.push({
        productoId: it.producto_id,
        oc: o.numero_oc ?? '',
        estado: o.estado ?? '',
        proveedor: uno<Fila>(o.proveedor)?.nombre ?? '',
        emision: o.fecha_emision ?? '',
        entrega: o.fecha_entrega ?? '',
        pedido,
        recibido,
        pendiente: Math.max(0, pedido - recibido),
        precio: num(it.precio_unit),
      })
    }
    if (lote.length < PAGINA) break
  }
  return acc
}

function acumular<T extends { productoId: string }>(items: T[], valor: (i: T) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of items) m.set(i.productoId, (m.get(i.productoId) ?? 0) + valor(i))
  return m
}

/**
 * Demanda comprometida por producto: se suma lo SOLICITADO (no lo pendiente por
 * alistar) porque el stock solo se descuenta al despachar — lo ya alistado
 * sigue contado en `stock.cantidad_real`. Igual que la vista
 * `v_recomendacion_compra` que alimenta /aprovisionamiento.
 */
const demandaPorProducto = (pedidos: ItemPedido[]) => acumular(pedidos, p => p.solicitado)
/** Lo no recibido de las OC abiertas, por producto. */
const ocPendientePorProducto = (ocs: ItemOC[]) => acumular(ocs, o => o.pendiente)

// ─── Columnas reutilizables ───────────────────────────────────────────────────

const COLS_ID: ColumnaInforme[] = [
  { header: 'Ref', key: 'ref', width: 8, formato: 'entero' },
  { header: 'Código', key: 'codigo', width: 10, formato: 'entero' },
  { header: 'SKU', key: 'sku', width: 14 },
  { header: 'Producto', key: 'producto', width: 46 },
  { header: 'Presentación', key: 'presentacion', width: 18 },
  { header: 'Tipo de insumo', key: 'tipo', width: 16 },
  { header: 'Rotación', key: 'rotacion', width: 10 },
]

const COLS_FICHA: ColumnaInforme[] = [
  { header: 'Stock real', key: 'stock_real', width: 12, formato: 'decimal' },
  { header: 'Disponible', key: 'stock_disp', width: 12, formato: 'decimal' },
  { header: 'Entrante', key: 'stock_entr', width: 11, formato: 'decimal' },
  { header: 'Saliente', key: 'stock_sal', width: 11, formato: 'decimal' },
  { header: 'Mínimo definido', key: 'min_def', width: 16, formato: 'decimal' },
  { header: 'Mínimo asignado', key: 'min_asig', width: 16, formato: 'decimal' },
  { header: 'Mínimo sugerido', key: 'min_suger', width: 16, formato: 'decimal' },
  { header: 'Precio lista', key: 'precio', width: 14, formato: 'cop' },
  { header: 'Valor en stock', key: 'valor_stock', width: 16, formato: 'cop' },
  { header: 'Proveedor', key: 'proveedor', width: 28 },
  { header: 'Tel. proveedor', key: 'proveedor_tel', width: 16 },
  { header: 'Proveedor alterno', key: 'proveedor2', width: 26 },
  { header: 'Precio alterno', key: 'precio2', width: 14, formato: 'cop' },
  { header: 'Índice rotación general', key: 'rot_general', width: 21, formato: 'decimal' },
  { header: 'Índice rotación mes', key: 'rot_mes', width: 19, formato: 'decimal' },
  { header: 'Bodega', key: 'bodega', width: 22 },
  { header: 'Ubicación', key: 'ubicacion', width: 22 },
  { header: 'Ubicación (texto libre)', key: 'ubicacion_texto', width: 24 },
  { header: 'Código de barras', key: 'codigo_barras', width: 18 },
  { header: 'Complemento', key: 'complemento', width: 30 },
  { header: 'Últ. inventario físico', key: 'inv_periodo', width: 19 },
  { header: 'Hallado en el conteo', key: 'inv_hallado', width: 19 },
  { header: 'Fecha del conteo', key: 'inv_fecha', width: 16 },
  { header: 'Activo', key: 'activo', width: 9 },
  { header: 'Creado', key: 'creado', width: 16 },
  { header: 'Actualizado', key: 'actualizado', width: 16 },
  { header: 'ID interno', key: 'id', width: 38 },
]

/** Columnas del informe: identificación + propias del informe + ficha completa. */
const columnas = (extras: ColumnaInforme[] = []): ColumnaInforme[] => [...COLS_ID, ...extras, ...COLS_FICHA]

const filaId = (p: Prod): Fila => ({
  ref: p.ref, codigo: p.codigo, sku: p.sku, producto: p.nombre,
  presentacion: p.presentacion, tipo: p.tipo, rotacion: p.cat,
})

const filaFicha = (p: Prod): Fila => ({
  stock_real: p.real, stock_disp: p.disp, stock_entr: p.entr, stock_sal: p.sal,
  min_def: p.minDef, min_asig: p.minAsig, min_suger: p.minSuger,
  precio: p.precio || null, valor_stock: p.real * p.precio,
  proveedor: p.proveedor, proveedor_tel: p.proveedorTel,
  proveedor2: p.proveedor2, precio2: p.precio2 || null,
  rot_general: p.rotGeneral, rot_mes: p.rotMes,
  bodega: p.bodega, ubicacion: p.ubicacion, ubicacion_texto: p.ubicacionTexto,
  codigo_barras: p.codigoBarras, complemento: p.complemento,
  inv_periodo: p.invPeriodo, inv_hallado: siNo(p.invHallado), inv_fecha: fecha(p.invFecha),
  activo: siNo(p.activo), creado: fechaHora(p.creado), actualizado: fechaHora(p.actualizado),
  id: p.id,
})

/** Fila completa del producto con las columnas propias del informe intercaladas. */
const fila = (p: Prod, extras: Fila = {}): Fila => ({ ...filaId(p), ...extras, ...filaFicha(p) })

/** Agrupa productos por una llave y devuelve una hoja de totales. */
function hojaAgrupada(nombre: string, etiqueta: string, prods: Prod[], llave: (p: Prod) => string): HojaInforme {
  const m = new Map<string, { n: number; unidades: number; valor: number; criticos: number }>()
  for (const p of prods) {
    const k = llave(p) || '(sin dato)'
    const e = m.get(k) ?? { n: 0, unidades: 0, valor: 0, criticos: 0 }
    e.n++
    e.unidades += p.real
    e.valor += p.real * p.precio
    if (p.minDef > 0 && p.real <= p.minDef) e.criticos++
    m.set(k, e)
  }
  return {
    nombre,
    columnas: [
      { header: etiqueta, key: 'grupo', width: 32 },
      { header: 'Productos', key: 'n', width: 12, formato: 'entero', total: true },
      { header: 'Unidades en stock', key: 'unidades', width: 18, formato: 'decimal', total: true },
      { header: 'Valor del stock', key: 'valor', width: 18, formato: 'cop', total: true },
      { header: 'Bajo el mínimo', key: 'criticos', width: 15, formato: 'entero', total: true },
    ],
    filas: [...m.entries()]
      .sort((a, b) => b[1].valor - a[1].valor)
      .map(([grupo, v]) => ({ grupo, ...v })),
  }
}

// ─── Catálogo de informes ─────────────────────────────────────────────────────

export const INFORMES: DefinicionInforme[] = [
  {
    id: 'inventario-completo',
    nombre: 'Inventario completo (catálogo + stock)',
    grupo: 'Inventario',
    archivo: 'inventario_completo',
    descripcion:
      'Todos los productos activos con su ficha completa: identificación, stock real / disponible / entrante / saliente, mínimos, precios, proveedores, ubicación en bodega y el último inventario físico.',
    incluye: ['Ficha completa del producto', 'Stock actual', 'Valorizado', 'Resumen por tipo y rotación'],
    async generar(supabase, progreso) {
      progreso('Leyendo productos y stock…')
      const prods = await cargarProductos(supabase)
      const unidades = prods.reduce((a, p) => a + p.real, 0)
      const valor = prods.reduce((a, p) => a + p.real * p.precio, 0)
      const criticos = prods.filter(p => p.minDef > 0 && p.real <= p.minDef).length
      const agotados = prods.filter(p => p.real <= 0).length
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Productos activos', valor: prods.length },
          { label: 'Unidades en stock', valor: miles(unidades) },
          { label: 'Valor del inventario', valor: cop(valor) },
          { label: 'Productos bajo el mínimo', valor: criticos },
          { label: 'Productos agotados (stock 0)', valor: agotados },
          { label: 'Sin precio de lista', valor: prods.filter(p => !p.precio).length },
          { label: 'Sin ubicación asignada', valor: prods.filter(p => !p.bodega && !p.ubicacion && !p.ubicacionTexto).length },
        ],
        hojas: [
          {
            nombre: 'Inventario',
            columnas: columnas([
              { header: 'Estado del stock', key: 'estado_stock', width: 18 },
              { header: 'Diferencia vs. mínimo', key: 'dif_min', width: 20, formato: 'decimal' },
            ]),
            filas: prods.map(p =>
              fila(p, {
                estado_stock: p.real <= 0 ? 'AGOTADO' : p.minDef > 0 && p.real <= p.minDef ? 'BAJO MÍNIMO' : 'OK',
                dif_min: p.real - p.minDef,
              }),
            ),
            resaltar: f => f.estado_stock !== 'OK',
            nota: 'Ordenado por tipo de insumo y nombre. Usa los filtros de la fila 1 para acotar.',
          },
          hojaAgrupada('Por tipo de insumo', 'Tipo de insumo', prods, p => p.tipo),
          hojaAgrupada('Por rotación', 'Categoría de rotación', prods, p => p.cat),
          hojaAgrupada('Por bodega', 'Bodega', prods, p => p.bodega || p.ubicacionTexto),
        ],
      }
    },
  },

  {
    id: 'falta-stock',
    nombre: 'Qué hace falta en stock (bajo el mínimo)',
    grupo: 'Inventario',
    archivo: 'falta_en_stock',
    descripcion:
      'Productos cuyo stock real está en o por debajo del mínimo definido, con las unidades que faltan para volver al mínimo y cuánto cuesta reponerlas. Incluye una hoja aparte con los agotados.',
    incluye: ['Faltante para el mínimo', 'Costo de reposición', 'Agotados', 'Ficha completa del producto'],
    async generar(supabase, progreso) {
      progreso('Leyendo productos y stock…')
      const prods = await cargarProductos(supabase)
      const bajos = prods
        .filter(p => p.minDef > 0 && p.real <= p.minDef)
        .map(p => ({ p, faltante: Math.max(0, p.minDef - p.real) }))
        .sort((a, b) => b.faltante * b.p.precio - a.faltante * a.p.precio)
      const agotados = prods.filter(p => p.real <= 0)
      const costo = bajos.reduce((a, b) => a + b.faltante * b.p.precio, 0)

      const colsFaltante: ColumnaInforme[] = [
        { header: 'Stock actual', key: 'actual', width: 13, formato: 'decimal' },
        { header: 'Stock mínimo', key: 'minimo', width: 13, formato: 'decimal' },
        { header: 'FALTANTE', key: 'faltante', width: 12, formato: 'decimal', total: true },
        { header: 'Costo de reposición', key: 'costo', width: 19, formato: 'cop', total: true },
        { header: 'Cobertura del mínimo', key: 'cobertura', width: 20 },
      ]
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Productos bajo el mínimo', valor: bajos.length },
          { label: 'Productos agotados (stock 0)', valor: agotados.length },
          { label: 'Unidades faltantes', valor: miles(bajos.reduce((a, b) => a + b.faltante, 0)) },
          { label: 'Costo total de reposición', valor: cop(costo) },
          { label: 'Faltantes de rotación A', valor: bajos.filter(b => b.p.cat === 'A').length },
          { label: 'Productos activos revisados', valor: prods.length },
        ],
        notas: [
          'El faltante se calcula contra el "stock mínimo definido" de cada producto. Los productos sin mínimo (0) no entran en esta lista.',
        ],
        hojas: [
          {
            nombre: 'Falta en stock',
            columnas: columnas(colsFaltante),
            filas: bajos.map(({ p, faltante }) =>
              fila(p, {
                actual: p.real,
                minimo: p.minDef,
                faltante,
                costo: faltante * p.precio,
                cobertura: p.minDef > 0 ? `${Math.round((p.real / p.minDef) * 100)}%` : '',
              }),
            ),
            resaltar: f => num(f.actual) <= 0,
            nota: 'Ordenado por costo de reposición (lo más caro de reponer primero).',
          },
          {
            nombre: 'Agotados',
            columnas: columnas([{ header: 'Stock mínimo', key: 'minimo', width: 13, formato: 'decimal' }]),
            filas: agotados.map(p => fila(p, { minimo: p.minDef })),
            nota: 'Productos activos con stock real en cero.',
          },
          hojaAgrupada('Por tipo de insumo', 'Tipo de insumo', bajos.map(b => b.p), p => p.tipo),
        ],
      }
    },
  },

  {
    id: 'necesita-comprar',
    nombre: 'Qué se necesita comprar (sugerido)',
    grupo: 'Compras',
    archivo: 'necesita_comprar',
    descripcion:
      'Cantidad a comprar por producto para cubrir el stock mínimo más lo que las sedes ya pidieron, descontando lo que hay en bodega y lo que viene en órdenes de compra abiertas.',
    incluye: ['Cantidad sugerida a comprar', 'Valor estimado', 'Pedido por las sedes', 'En camino en OC', 'Proveedor y precio'],
    async generar(supabase, progreso) {
      progreso('Leyendo productos, pedidos y órdenes de compra…')
      const [prods, pedidos, ocs] = await Promise.all([
        cargarProductos(supabase),
        cargarPedidosPendientes(supabase),
        cargarOCAbiertas(supabase),
      ])
      const demanda = demandaPorProducto(pedidos)
      const enCamino = ocPendientePorProducto(ocs)

      const filas = prods
        .map(p => {
          const comprometido = demanda.get(p.id) ?? 0
          const camino = enCamino.get(p.id) ?? 0
          const comprar = Math.max(0, p.minDef + comprometido - p.real - camino)
          return { p, comprometido, camino, comprar }
        })
        .filter(r => r.comprar > 0)
        .sort((a, b) => b.comprar * b.p.precio - a.comprar * a.p.precio)

      const valor = filas.reduce((a, r) => a + r.comprar * r.p.precio, 0)
      const colsCompra: ColumnaInforme[] = [
        { header: 'A COMPRAR', key: 'comprar', width: 14, formato: 'decimal', total: true },
        { header: 'Valor estimado', key: 'valor', width: 17, formato: 'cop', total: true },
        { header: 'Stock actual', key: 'actual', width: 13, formato: 'decimal' },
        { header: 'Stock mínimo', key: 'minimo', width: 13, formato: 'decimal' },
        { header: 'Pedido por las sedes', key: 'comprometido', width: 20, formato: 'decimal', total: true },
        { header: 'En camino (OC)', key: 'camino', width: 15, formato: 'decimal', total: true },
      ]
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Productos a comprar', valor: filas.length },
          { label: 'Unidades a comprar', valor: miles(filas.reduce((a, r) => a + r.comprar, 0)) },
          { label: 'Valor estimado de la compra', valor: cop(valor) },
          { label: 'Con proveedor asignado', valor: filas.filter(r => r.p.proveedor).length },
          { label: 'Sin precio de lista', valor: filas.filter(r => !r.p.precio).length },
          { label: 'Productos activos revisados', valor: prods.length },
        ],
        notas: [
          'Fórmula: a comprar = máx(0, stock mínimo + pedido por las sedes − stock real − pendiente por recibir en OC). Es la misma de la vista v_recomendacion_compra que alimenta la pantalla de Aprovisionamiento.',
          `Cuenta como "pedido por las sedes" la cantidad solicitada en órdenes de insumo en estado: ${ESTADOS_OI_PENDIENTES.join(', ')}. Se toma lo solicitado completo (no lo pendiente por alistar) porque el stock solo se descuenta al despachar.`,
          `Cuenta como "en camino" lo no recibido de órdenes de compra en estado: ${ESTADOS_OC_ABIERTAS.join(', ')}.`,
        ],
        hojas: [
          {
            nombre: 'A comprar',
            columnas: columnas(colsCompra),
            filas: filas.map(({ p, comprometido, camino, comprar }) =>
              fila(p, { comprar, valor: comprar * p.precio, actual: p.real, minimo: p.minDef, comprometido, camino }),
            ),
            resaltar: f => num(f.actual) <= 0,
            nota: 'Ordenado por valor estimado de compra. Es la lista lista para cotizar.',
          },
          {
            nombre: 'Por proveedor',
            columnas: [
              { header: 'Proveedor', key: 'proveedor', width: 32 },
              { header: 'Teléfono', key: 'telefono', width: 16 },
              { header: 'Productos', key: 'n', width: 12, formato: 'entero', total: true },
              { header: 'Unidades', key: 'unidades', width: 14, formato: 'decimal', total: true },
              { header: 'Valor estimado', key: 'valor', width: 18, formato: 'cop', total: true },
            ],
            filas: (() => {
              const m = new Map<string, { proveedor: string; telefono: string; n: number; unidades: number; valor: number }>()
              for (const { p, comprar } of filas) {
                const k = p.proveedor || '(sin proveedor)'
                const e = m.get(k) ?? { proveedor: k, telefono: p.proveedorTel, n: 0, unidades: 0, valor: 0 }
                e.n++
                e.unidades += comprar
                e.valor += comprar * p.precio
                m.set(k, e)
              }
              return [...m.values()].sort((a, b) => b.valor - a.valor)
            })(),
          },
        ],
      }
    },
  },

  {
    id: 'pedido-sin-comprar',
    nombre: 'Pedido por las sedes y aún sin comprar',
    grupo: 'Compras',
    archivo: 'pedido_sin_comprar',
    descripcion:
      'Lo que las sedes ya solicitaron en órdenes de insumo y todavía no sale de bodega, indicando cuánto alcanza a cubrir el stock y cuánto hay que comprar de verdad.',
    incluye: ['Consolidado por producto', 'Detalle por orden y sede', 'Cubierto con stock', 'Falta comprar'],
    async generar(supabase, progreso) {
      progreso('Leyendo órdenes de insumo pendientes…')
      const [prods, pedidos, ocs] = await Promise.all([
        cargarProductos(supabase),
        cargarPedidosPendientes(supabase),
        cargarOCAbiertas(supabase),
      ])
      const porProd = new Map(prods.map(p => [p.id, p]))
      const enCamino = ocPendientePorProducto(ocs)

      const agrup = new Map<string, { solicitado: number; alistado: number; porAlistar: number; ordenes: Set<string>; sedes: Set<string> }>()
      for (const it of pedidos) {
        const e = agrup.get(it.productoId) ?? { solicitado: 0, alistado: 0, porAlistar: 0, ordenes: new Set<string>(), sedes: new Set<string>() }
        e.solicitado += it.solicitado
        e.alistado += it.alistado
        e.porAlistar += it.pendiente
        if (it.orden) e.ordenes.add(it.orden)
        if (it.sede) e.sedes.add(it.sede)
        agrup.set(it.productoId, e)
      }

      const consolidado = [...agrup.entries()]
        .map(([id, v]) => {
          const p = porProd.get(id)
          const camino = enCamino.get(id) ?? 0
          const stock = p ? Math.max(0, p.real) : 0
          return {
            p,
            ...v,
            camino,
            cubierto: Math.min(v.solicitado, stock),
            faltaComprar: Math.max(0, v.solicitado - stock - camino),
          }
        })
        .filter(r => r.p && r.solicitado > 0)
        .sort((a, b) => b.faltaComprar * (b.p?.precio ?? 0) - a.faltaComprar * (a.p?.precio ?? 0))

      const colsPedido: ColumnaInforme[] = [
        { header: 'Pedido sin despachar', key: 'solicitado', width: 20, formato: 'decimal', total: true },
        { header: 'Cubierto con stock', key: 'cubierto', width: 18, formato: 'decimal', total: true },
        { header: 'FALTA COMPRAR', key: 'falta', width: 16, formato: 'decimal', total: true },
        { header: 'Valor a comprar', key: 'valor_falta', width: 17, formato: 'cop', total: true },
        { header: 'En camino (OC)', key: 'camino', width: 15, formato: 'decimal', total: true },
        { header: 'Ya alistado en bodega', key: 'alistado', width: 21, formato: 'decimal', total: true },
        { header: 'Por alistar', key: 'por_alistar', width: 13, formato: 'decimal', total: true },
        { header: 'Órdenes', key: 'ordenes', width: 11, formato: 'entero' },
        { header: 'Sedes', key: 'sedes', width: 10, formato: 'entero' },
      ]
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Productos pedidos sin despachar', valor: consolidado.length },
          { label: 'Unidades pedidas sin despachar', valor: miles(consolidado.reduce((a, r) => a + r.solicitado, 0)) },
          { label: 'Unidades ya alistadas en bodega', valor: miles(consolidado.reduce((a, r) => a + r.alistado, 0)) },
          { label: 'Unidades que faltan por comprar', valor: miles(consolidado.reduce((a, r) => a + r.faltaComprar, 0)) },
          { label: 'Valor de lo que falta comprar', valor: cop(consolidado.reduce((a, r) => a + r.faltaComprar * (r.p?.precio ?? 0), 0)) },
          { label: 'Órdenes de insumo involucradas', valor: new Set(pedidos.map(p => p.orden)).size },
          { label: 'Sedes involucradas', valor: new Set(pedidos.map(p => p.sede)).size },
        ],
        notas: [
          `Órdenes de insumo consideradas (aún sin despachar): ${ESTADOS_OI_PENDIENTES.join(', ')}.`,
          'Falta comprar = pedido sin despachar − stock real − pendiente por recibir en OC. Se mide contra lo solicitado completo porque el stock solo baja al despachar: lo ya alistado sigue contado en el stock real.',
        ],
        hojas: [
          {
            nombre: 'Consolidado por producto',
            columnas: columnas(colsPedido),
            filas: consolidado.map(r =>
              fila(r.p as Prod, {
                solicitado: r.solicitado,
                cubierto: r.cubierto,
                falta: r.faltaComprar,
                valor_falta: r.faltaComprar * (r.p?.precio ?? 0),
                camino: r.camino,
                alistado: r.alistado,
                por_alistar: r.porAlistar,
                ordenes: r.ordenes.size,
                sedes: r.sedes.size,
              }),
            ),
            resaltar: f => num(f.falta) > 0,
            nota: 'Las filas resaltadas no se alcanzan a cubrir con el stock ni con lo que ya viene en camino: eso es lo que hay que comprar.',
          },
          {
            nombre: 'Detalle por orden',
            columnas: [
              { header: 'N.º orden', key: 'orden', width: 18 },
              { header: 'Estado', key: 'estado', width: 20 },
              { header: 'Sede', key: 'sede', width: 34 },
              { header: 'Ciudad', key: 'ciudad', width: 16 },
              { header: 'Contrato', key: 'contrato', width: 11 },
              { header: 'Creada', key: 'creada', width: 16 },
              { header: 'Ref', key: 'ref', width: 8, formato: 'entero' },
              { header: 'Código', key: 'codigo', width: 10, formato: 'entero' },
              { header: 'Producto', key: 'producto', width: 46 },
              { header: 'Presentación', key: 'presentacion', width: 18 },
              { header: 'Tipo de insumo', key: 'tipo', width: 16 },
              { header: 'Solicitado', key: 'solicitado', width: 12, formato: 'decimal', total: true },
              { header: 'Ya alistado', key: 'alistado', width: 13, formato: 'decimal', total: true },
              { header: 'Por alistar', key: 'por_alistar', width: 13, formato: 'decimal', total: true },
              { header: 'Stock actual', key: 'stock_real', width: 13, formato: 'decimal' },
              { header: 'Precio lista', key: 'precio', width: 14, formato: 'cop' },
              { header: 'Valor solicitado', key: 'valor', width: 17, formato: 'cop', total: true },
              { header: 'Proveedor', key: 'proveedor', width: 28 },
            ],
            filas: pedidos
              .filter(it => it.solicitado > 0)
              .sort((a, b) => a.orden.localeCompare(b.orden))
              .map(it => {
                const p = porProd.get(it.productoId)
                return {
                  orden: it.orden, estado: it.estado, sede: it.sede, ciudad: it.ciudad,
                  contrato: it.contrato, creada: fechaHora(it.creada),
                  ref: p?.ref ?? null, codigo: p?.codigo ?? null, producto: p?.nombre ?? '(producto no visible)',
                  presentacion: p?.presentacion ?? '', tipo: p?.tipo ?? '',
                  solicitado: it.solicitado, alistado: it.alistado, por_alistar: it.pendiente,
                  stock_real: p?.real ?? 0, precio: p?.precio || null,
                  valor: it.solicitado * (p?.precio ?? 0), proveedor: p?.proveedor ?? '',
                }
              }),
          },
        ],
      }
    },
  },

  {
    id: 'oc-pendiente',
    nombre: 'Ya comprado pero sin recibir (OC abiertas)',
    grupo: 'Compras',
    archivo: 'oc_pendiente_recibir',
    descripcion:
      'Órdenes de compra abiertas con lo que todavía no llega del proveedor: cuánto se pidió, cuánto se recibió y cuánto falta, con la ficha del producto.',
    incluye: ['Pendiente por recibir', 'Valor pendiente', 'Proveedor y fechas', 'Consolidado por producto'],
    async generar(supabase, progreso) {
      progreso('Leyendo órdenes de compra abiertas…')
      const [prods, ocs] = await Promise.all([cargarProductos(supabase, false), cargarOCAbiertas(supabase)])
      const porProd = new Map(prods.map(p => [p.id, p]))
      const pendientes = ocs.filter(o => o.pendiente > 0)
      const valor = pendientes.reduce((a, o) => a + o.pendiente * o.precio, 0)

      const consol = new Map<string, { pendiente: number; pedido: number; recibido: number; valor: number; ocs: Set<string> }>()
      for (const o of pendientes) {
        const e = consol.get(o.productoId) ?? { pendiente: 0, pedido: 0, recibido: 0, valor: 0, ocs: new Set<string>() }
        e.pendiente += o.pendiente
        e.pedido += o.pedido
        e.recibido += o.recibido
        e.valor += o.pendiente * o.precio
        e.ocs.add(o.oc)
        consol.set(o.productoId, e)
      }
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Ítems pendientes por recibir', valor: pendientes.length },
          { label: 'Órdenes de compra abiertas', valor: new Set(pendientes.map(o => o.oc)).size },
          { label: 'Unidades por recibir', valor: miles(pendientes.reduce((a, o) => a + o.pendiente, 0)) },
          { label: 'Valor pendiente por recibir', valor: cop(valor) },
          { label: 'Proveedores involucrados', valor: new Set(pendientes.map(o => o.proveedor)).size },
        ],
        notas: [`Estados de OC considerados abiertos: ${ESTADOS_OC_ABIERTAS.join(', ')}.`],
        hojas: [
          {
            nombre: 'Detalle por OC',
            columnas: [
              { header: 'N.º OC', key: 'oc', width: 18 },
              { header: 'Estado', key: 'estado', width: 14 },
              { header: 'Proveedor', key: 'proveedor', width: 30 },
              { header: 'Emisión', key: 'emision', width: 13 },
              { header: 'Entrega pactada', key: 'entrega', width: 16 },
              { header: 'Ref', key: 'ref', width: 8, formato: 'entero' },
              { header: 'Código', key: 'codigo', width: 10, formato: 'entero' },
              { header: 'Producto', key: 'producto', width: 46 },
              { header: 'Presentación', key: 'presentacion', width: 18 },
              { header: 'Tipo de insumo', key: 'tipo', width: 16 },
              { header: 'Pedido', key: 'pedido', width: 11, formato: 'decimal', total: true },
              { header: 'Recibido', key: 'recibido', width: 11, formato: 'decimal', total: true },
              { header: 'Pendiente', key: 'pendiente', width: 12, formato: 'decimal', total: true },
              { header: 'Precio unitario', key: 'precio', width: 16, formato: 'cop' },
              { header: 'Valor pendiente', key: 'valor', width: 17, formato: 'cop', total: true },
              { header: 'Stock actual', key: 'stock_real', width: 13, formato: 'decimal' },
            ],
            filas: pendientes
              .sort((a, b) => a.oc.localeCompare(b.oc))
              .map(o => {
                const p = porProd.get(o.productoId)
                return {
                  oc: o.oc, estado: o.estado, proveedor: o.proveedor,
                  emision: fecha(o.emision), entrega: fecha(o.entrega),
                  ref: p?.ref ?? null, codigo: p?.codigo ?? null, producto: p?.nombre ?? '(producto no visible)',
                  presentacion: p?.presentacion ?? '', tipo: p?.tipo ?? '',
                  pedido: o.pedido, recibido: o.recibido, pendiente: o.pendiente,
                  precio: o.precio || null, valor: o.pendiente * o.precio, stock_real: p?.real ?? 0,
                }
              }),
          },
          {
            nombre: 'Consolidado por producto',
            columnas: columnas([
              { header: 'Pendiente por recibir', key: 'pendiente', width: 20, formato: 'decimal', total: true },
              { header: 'Valor pendiente', key: 'valor_pend', width: 17, formato: 'cop', total: true },
              { header: 'Pedido en OC', key: 'pedido', width: 14, formato: 'decimal', total: true },
              { header: 'Recibido', key: 'recibido', width: 12, formato: 'decimal', total: true },
              { header: 'N.º de OC', key: 'n_ocs', width: 11, formato: 'entero' },
            ]),
            filas: [...consol.entries()]
              .filter(([id]) => porProd.has(id))
              .sort((a, b) => b[1].valor - a[1].valor)
              .map(([id, v]) =>
                fila(porProd.get(id) as Prod, {
                  pendiente: v.pendiente, valor_pend: v.valor, pedido: v.pedido,
                  recibido: v.recibido, n_ocs: v.ocs.size,
                }),
              ),
          },
        ],
      }
    },
  },

  {
    id: 'no-hallados',
    nombre: 'No hallados en el último inventario físico',
    grupo: 'Inventario',
    archivo: 'no_hallados_inventario_fisico',
    descripcion:
      'Productos marcados como no encontrados en el cruce del conteo físico, con el periodo del conteo y el saldo que sigue registrado en el sistema.',
    incluye: ['Periodo del conteo', 'Saldo en el sistema', 'Valor en libros', 'Productos sin cruzar'],
    async generar(supabase, progreso) {
      progreso('Leyendo el cruce del inventario físico…')
      const prods = await cargarProductos(supabase, false)
      const noHallados = prods.filter(p => p.invHallado === false)
      const sinCruzar = prods.filter(p => p.invHallado === null && p.activo)
      const periodos = [...new Set(noHallados.map(p => p.invPeriodo).filter(Boolean))]
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Productos no hallados', valor: noHallados.length },
          { label: 'Periodo(s) del conteo', valor: periodos.join(', ') || '—' },
          { label: 'Unidades registradas en el sistema', valor: miles(noHallados.reduce((a, p) => a + p.real, 0)) },
          { label: 'Valor registrado en el sistema', valor: cop(noHallados.reduce((a, p) => a + p.real * p.precio, 0)) },
          { label: 'Productos activos sin cruzar', valor: sinCruzar.length },
        ],
        notas: ['Un producto "no hallado" se conserva en el catálogo pero queda etiquetado; conviene revisarlo antes de volver a comprarlo.'],
        hojas: [
          {
            nombre: 'No hallados',
            columnas: columnas([{ header: 'Valor en libros', key: 'valor_libros', width: 17, formato: 'cop', total: true }]),
            filas: noHallados
              .sort((a, b) => b.real * b.precio - a.real * a.precio)
              .map(p => fila(p, { valor_libros: p.real * p.precio })),
          },
          {
            nombre: 'Sin cruzar',
            columnas: columnas(),
            filas: sinCruzar.map(p => fila(p)),
            nota: 'Productos activos que no aparecen en ningún cruce de inventario físico.',
          },
        ],
      }
    },
  },

  {
    id: 'valorizado',
    nombre: 'Inventario valorizado (resumen gerencial)',
    grupo: 'Inventario',
    archivo: 'inventario_valorizado',
    descripcion:
      'Valor del inventario agrupado por tipo de insumo, rotación, bodega y proveedor, más el ranking de los productos que concentran el valor.',
    incluye: ['Valor por tipo, rotación y bodega', 'Valor por proveedor', 'Top 100 por valor'],
    async generar(supabase, progreso) {
      progreso('Leyendo productos y stock…')
      const prods = await cargarProductos(supabase)
      const valor = prods.reduce((a, p) => a + p.real * p.precio, 0)
      const top = [...prods].sort((a, b) => b.real * b.precio - a.real * a.precio).slice(0, 100)
      const valorTop = top.reduce((a, p) => a + p.real * p.precio, 0)
      progreso('Armando el Excel…')
      return {
        resumen: [
          { label: 'Valor total del inventario', valor: cop(valor) },
          { label: 'Productos activos', valor: prods.length },
          { label: 'Unidades en stock', valor: miles(prods.reduce((a, p) => a + p.real, 0)) },
          { label: 'Concentración en el top 100', valor: valor > 0 ? `${Math.round((valorTop / valor) * 100)}%` : '0%' },
          { label: 'Productos sin precio (no valorizados)', valor: prods.filter(p => !p.precio).length },
        ],
        hojas: [
          hojaAgrupada('Por tipo de insumo', 'Tipo de insumo', prods, p => p.tipo),
          hojaAgrupada('Por rotación', 'Categoría de rotación', prods, p => p.cat),
          hojaAgrupada('Por bodega', 'Bodega', prods, p => p.bodega || p.ubicacionTexto),
          hojaAgrupada('Por proveedor', 'Proveedor', prods, p => p.proveedor),
          {
            nombre: 'Top 100 por valor',
            columnas: columnas([{ header: 'Participación', key: 'participacion', width: 14 }]),
            filas: top.map(p => fila(p, { participacion: valor > 0 ? `${(((p.real * p.precio) / valor) * 100).toFixed(2)}%` : '' })),
          },
        ],
      }
    },
  },
]

export const GRUPOS_INFORME = [...new Set(INFORMES.map(i => i.grupo))]

// ─── Generación del archivo .xlsx ─────────────────────────────────────────────

const VERDE = 'FF2E7D32'
const VERDE_OSCURO = 'FF1B5E20'
const ROJO_SUAVE = 'FFFDECEA'

const NUMFMT: Partial<Record<Formato, string>> = {
  entero: '#,##0',
  decimal: '#,##0.##',
  cop: '"$" #,##0',
}

/** Construye y descarga el .xlsx del informe. Devuelve las filas escritas. */
export async function descargarInforme(
  informe: DefinicionInforme,
  supabase: DB,
  progreso: (paso: string) => void,
): Promise<number> {
  const res = await informe.generar(supabase, progreso)
  progreso('Generando el archivo…')

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conserjes Inmobiliarios · Inventario'
  wb.created = new Date()

  // ── Hoja de resumen ────────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
  ws.columns = [{ width: 48 }, { width: 34 }]

  ws.mergeCells('A1:B1')
  const titulo = ws.getCell('A1')
  titulo.value = informe.nombre
  titulo.font = { bold: true, size: 16, color: { argb: VERDE_OSCURO } }
  titulo.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 26

  ws.mergeCells('A2:B2')
  const desc = ws.getCell('A2')
  desc.value = informe.descripcion
  desc.font = { size: 10, italic: true, color: { argb: 'FF616161' } }
  desc.alignment = { wrapText: true, vertical: 'top' }
  ws.getRow(2).height = 46

  ws.mergeCells('A3:B3')
  ws.getCell('A3').value = `Generado el ${fechaHora(new Date().toISOString())}`
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF9E9E9E' } }
  ws.addRow([])

  const enc = ws.addRow(['Indicador', 'Valor'])
  enc.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  enc.height = 20
  enc.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    c.alignment = { vertical: 'middle' }
  })
  for (const r of res.resumen) {
    const row = ws.addRow([r.label, r.valor])
    row.getCell(2).font = { bold: true, size: 11 }
    row.eachCell(c => { c.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } } })
  }

  ws.addRow([])
  ws.addRow(['Hojas de este archivo', '']).getCell(1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
  for (const h of res.hojas) {
    const row = ws.addRow([h.nombre, `${h.filas.length.toLocaleString('es-CO')} filas`])
    row.getCell(2).font = { color: { argb: 'FF757575' } }
  }

  if (res.notas?.length) {
    ws.addRow([])
    ws.addRow(['Cómo se calculó', '']).getCell(1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    for (const nota of res.notas) {
      const row = ws.addRow([nota, ''])
      ws.mergeCells(`A${row.number}:B${row.number}`)
      row.getCell(1).font = { size: 9, color: { argb: 'FF757575' } }
      row.getCell(1).alignment = { wrapText: true, vertical: 'top' }
      row.height = 30
    }
  }

  // ── Hojas de detalle ───────────────────────────────────────────────────────
  let totalFilas = 0
  for (const hoja of res.hojas) {
    const hs = wb.addWorksheet(hoja.nombre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
    hs.columns = hoja.columnas.map(c => ({
      header: c.header,
      key: c.key,
      width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)),
      style: c.formato && NUMFMT[c.formato] ? { numFmt: NUMFMT[c.formato] } : undefined,
    }))

    const header = hs.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    header.alignment = { vertical: 'middle', wrapText: true }
    header.height = 28
    header.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
      c.border = { bottom: { style: 'thin', color: { argb: VERDE_OSCURO } } }
    })

    if (hoja.filas.length === 0) {
      hs.addRow({ [hoja.columnas[0].key]: '(sin registros)' })
    } else {
      for (const f of hoja.filas) {
        const row = hs.addRow(f)
        if (hoja.resaltar?.(f)) {
          row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_SUAVE } } })
        }
      }
      const conTotal = hoja.columnas.filter(c => c.total)
      if (conTotal.length > 0) {
        const tot: Fila = { [hoja.columnas[0].key]: 'TOTAL' }
        for (const c of conTotal) tot[c.key] = hoja.filas.reduce((a, f) => a + num(f[c.key]), 0)
        const row = hs.addRow(tot)
        row.font = { bold: true }
        row.eachCell(c => {
          c.border = { top: { style: 'double', color: { argb: VERDE_OSCURO } } }
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } }
        })
      }
    }

    hs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnas.length } }
    if (hoja.nota) {
      const vacia = hs.addRow({})
      const celda = hs.getCell(`A${vacia.number + 1}`)
      celda.value = hoja.nota
      celda.font = { size: 9, italic: true, color: { argb: 'FF9E9E9E' } }
    }
    totalFilas += hoja.filas.length
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${informe.archivo}_${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  return totalFilas
}
