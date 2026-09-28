// Lógica pura del módulo Inventario físico: comparar dos conteos, comparar un
// conteo contra el stock del sistema y armar la tendencia por producto.
// Sin dependencias de React ni de Supabase para poder usarla en cliente y
// servidor por igual.

export interface InventarioFisico {
  id: string
  periodo: string
  fecha_corte: string
  archivo_nombre: string | null
  observacion: string | null
  historico: boolean
  total_items: number
  items_con_cantidad: number
  items_en_cero: number
  total_unidades: number
  items_nuevos: number
  items_ajustados: number
  items_no_hallados: number
  created_at: string
}

export type EstadoItem = 'CONTADO' | 'SIN_CANTIDAD' | 'NO_HALLADO'

export interface ItemFisico {
  inventario_id: string
  producto_id: string | null
  codigo: number | null
  nombre: string
  presentacion: string | null
  estado: EstadoItem
  cantidad_contada: number | null
  stock_sistema: number | null
  diferencia: number | null
  precio_unitario: number | null
  producto_nuevo: boolean
}

/** Clave estable de un producto entre conteos (el id; si se borró, el código). */
export const claveItem = (i: Pick<ItemFisico, 'producto_id' | 'codigo' | 'nombre'>) =>
  i.producto_id ?? (i.codigo !== null ? `c:${i.codigo}` : `n:${i.nombre}`)

/** ¿El producto vino en el archivo de ese conteo? */
export const vinoEnConteo = (i: ItemFisico) => i.estado !== 'NO_HALLADO'

// ── Comparativa entre dos conteos ────────────────────────────────────────────

export type EstadoComparacion =
  | 'FALTANTE'    // estaba en el conteo anterior y ya no viene
  | 'NUEVO'       // no estaba en el anterior y ahora sí
  | 'AGOTADO'     // tenía existencias y ahora está en cero
  | 'REPUESTO'    // estaba en cero y ahora tiene existencias
  | 'BAJO'
  | 'SUBIO'
  | 'IGUAL'
  | 'SIN_DATO'    // una de las dos celdas vino vacía

export const ETIQUETA_COMPARACION: Record<EstadoComparacion, string> = {
  FALTANTE: 'Faltante',
  NUEVO: 'Nuevo en conteo',
  AGOTADO: 'Se agotó',
  REPUESTO: 'Repuesto',
  BAJO: 'Bajó',
  SUBIO: 'Subió',
  IGUAL: 'Sin cambio',
  SIN_DATO: 'Sin dato',
}

export interface FilaComparacion {
  clave: string
  codigo: number | null
  nombre: string
  presentacion: string | null
  anterior: number | null
  actual: number | null
  diferencia: number | null
  porcentaje: number | null
  precio: number | null
  valorDiferencia: number | null
  estado: EstadoComparacion
}

function estadoComparacion(a: ItemFisico | undefined, b: ItemFisico | undefined): EstadoComparacion {
  const enA = !!a && vinoEnConteo(a)
  const enB = !!b && vinoEnConteo(b)
  if (enA && !enB) return 'FALTANTE'
  if (!enA && enB) return 'NUEVO'
  const qa = a?.cantidad_contada ?? null
  const qb = b?.cantidad_contada ?? null
  if (qa === null || qb === null) return 'SIN_DATO'
  if (qa > 0 && qb === 0) return 'AGOTADO'
  if (qa === 0 && qb > 0) return 'REPUESTO'
  if (qb < qa) return 'BAJO'
  if (qb > qa) return 'SUBIO'
  return 'IGUAL'
}

/** Compara el conteo A (anterior) contra el B (actual), producto por producto. */
export function compararConteos(itemsA: ItemFisico[], itemsB: ItemFisico[]): FilaComparacion[] {
  const mapA = new Map(itemsA.map(i => [claveItem(i), i]))
  const mapB = new Map(itemsB.map(i => [claveItem(i), i]))
  const claves = new Set([...mapA.keys(), ...mapB.keys()])
  const filas: FilaComparacion[] = []
  for (const clave of claves) {
    const a = mapA.get(clave)
    const b = mapB.get(clave)
    // Productos que no vinieron en ninguno de los dos conteos no aportan nada
    if (!(a && vinoEnConteo(a)) && !(b && vinoEnConteo(b))) continue
    const ref = b ?? a!
    const anterior = a && vinoEnConteo(a) ? a.cantidad_contada : null
    const actual = b && vinoEnConteo(b) ? b.cantidad_contada : null
    const estado = estadoComparacion(a, b)
    // Un faltante cuenta como que el actual es 0; un nuevo, que el anterior era 0
    const qa = estado === 'NUEVO' ? 0 : anterior
    const qb = estado === 'FALTANTE' ? 0 : actual
    const diferencia = qa !== null && qb !== null ? qb - qa : null
    const precio = b?.precio_unitario ?? a?.precio_unitario ?? null
    filas.push({
      clave,
      codigo: ref.codigo,
      nombre: ref.nombre,
      presentacion: ref.presentacion,
      anterior,
      actual,
      diferencia,
      porcentaje: diferencia !== null && qa ? (diferencia / qa) * 100 : null,
      precio,
      valorDiferencia: diferencia !== null && precio ? diferencia * precio : null,
      estado,
    })
  }
  return filas.sort((x, y) => (x.codigo ?? 1e9) - (y.codigo ?? 1e9) || x.nombre.localeCompare(y.nombre))
}

export function resumenComparacion(filas: FilaComparacion[]) {
  const cuenta = (e: EstadoComparacion) => filas.filter(f => f.estado === e).length
  const sum = (sel: (f: FilaComparacion) => number | null) => filas.reduce((s, f) => s + (sel(f) ?? 0), 0)
  return {
    faltantes: cuenta('FALTANTE'),
    nuevos: cuenta('NUEVO'),
    agotados: cuenta('AGOTADO'),
    repuestos: cuenta('REPUESTO'),
    bajaron: cuenta('BAJO'),
    subieron: cuenta('SUBIO'),
    iguales: cuenta('IGUAL'),
    sinDato: cuenta('SIN_DATO'),
    unidadesAnterior: sum(f => f.anterior),
    unidadesActual: sum(f => f.actual),
    valorPerdido: sum(f => (f.valorDiferencia !== null && f.valorDiferencia < 0 ? f.valorDiferencia : 0)),
    valorGanado: sum(f => (f.valorDiferencia !== null && f.valorDiferencia > 0 ? f.valorDiferencia : 0)),
  }
}

// ── Conteo vs sistema (lo contado frente a lo que decía el stock) ───────────

export type EstadoSistema = 'FALTANTE' | 'SOBRANTE' | 'CUADRA' | 'NO_HALLADO' | 'SIN_CANTIDAD'

export const ETIQUETA_SISTEMA: Record<EstadoSistema, string> = {
  FALTANTE: 'Faltante físico',
  SOBRANTE: 'Sobrante',
  CUADRA: 'Cuadra',
  NO_HALLADO: 'No hallado',
  SIN_CANTIDAD: 'Sin cantidad',
}

export function estadoSistema(i: ItemFisico): EstadoSistema {
  if (i.estado === 'NO_HALLADO') return 'NO_HALLADO'
  if (i.estado === 'SIN_CANTIDAD' || i.diferencia === null) return 'SIN_CANTIDAD'
  if (i.diferencia < 0) return 'FALTANTE'
  if (i.diferencia > 0) return 'SOBRANTE'
  return 'CUADRA'
}

// ── Tendencia por producto en todos los conteos ─────────────────────────────

export interface FilaTendencia {
  clave: string
  codigo: number | null
  nombre: string
  presentacion: string | null
  /** Cantidad por inventario_id (null = celda vacía; ausente = no vino) */
  valores: Record<string, number | null>
  /** En cuántos conteos vino */
  apariciones: number
  /** Último conteo en el que vino (id), para detectar los que desaparecieron */
  ultimo: string | null
}

/** `inventarios` en orden cronológico ascendente. */
export function tendencia(inventarios: InventarioFisico[], items: ItemFisico[]): FilaTendencia[] {
  const orden = new Map(inventarios.map((inv, i) => [inv.id, i]))
  const filas = new Map<string, FilaTendencia>()
  for (const it of items) {
    if (!vinoEnConteo(it) || !orden.has(it.inventario_id)) continue
    const clave = claveItem(it)
    let f = filas.get(clave)
    if (!f) {
      f = { clave, codigo: it.codigo, nombre: it.nombre, presentacion: it.presentacion, valores: {}, apariciones: 0, ultimo: null }
      filas.set(clave, f)
    }
    f.valores[it.inventario_id] = it.cantidad_contada
    f.apariciones++
    if (f.ultimo === null || orden.get(it.inventario_id)! > orden.get(f.ultimo)!) {
      f.ultimo = it.inventario_id
      // El nombre más reciente es el que manda
      f.nombre = it.nombre
      f.presentacion = it.presentacion
    }
  }
  return [...filas.values()].sort((x, y) => (x.codigo ?? 1e9) - (y.codigo ?? 1e9) || x.nombre.localeCompare(y.nombre))
}

// ── Lectura del Excel de conteo (ITEM | NOMBRE ESTANDAR | PRESENTACION | CANTIDADES) ──

export interface FilaArchivo {
  codigo: number
  nombre: string
  presentacion: string | null
  cantidad: number | null
}

const normalizar = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase()

/** Ubica las columnas por el encabezado (tolera mayúsculas, tildes y variantes). */
export function detectarColumnas(encabezado: unknown[]): { codigo: number; nombre: number; presentacion: number; cantidad: number } | null {
  const h = encabezado.map(normalizar)
  const buscar = (...pistas: string[]) => h.findIndex(x => pistas.some(p => x === p || x.startsWith(p)))
  const codigo = buscar('ITEM', 'CODIGO', 'COD')
  const nombre = buscar('NOMBRE ESTANDAR', 'NOMBRE', 'PRODUCTO', 'DESCRIPCION')
  const presentacion = buscar('PRESENTACION', 'UNIDAD')
  const cantidad = buscar('CANTIDADES', 'CANTIDAD', 'CONTEO', 'EXISTENCIA', 'STOCK')
  if (codigo < 0 || nombre < 0 || cantidad < 0) return null
  return { codigo, nombre, presentacion, cantidad }
}

export function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/[$\s]/g, '').replace(/,/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Periodo sugerido a partir de una fecha: "SEPTIEMBRE 2026". */
export function periodoDe(fecha: Date): string {
  const mes = fecha.toLocaleDateString('es-CO', { month: 'long', timeZone: 'America/Bogota' })
  return `${mes} ${fecha.getFullYear()}`.toUpperCase()
}
