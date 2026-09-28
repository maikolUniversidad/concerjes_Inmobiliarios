// Cálculos del reporte "Inventario, consumo y proyección".
//
// Funciones puras (sin Supabase, sin Excel, sin DOM) para poder probarlas con
// datos de ejemplo. El reporte (reporte-proyeccion.ts) solo carga los datos y
// los escribe en el libro.
//
// Definiciones:
//   · reservado  = lo solicitado en órdenes de insumo que aún no salen de bodega
//                  (v_stock_proyectado.comprometido).
//   · disponible = stock real − reservado. Negativo = se pidió más de lo que hay.
//   · consumo    = salidas + traslados − devoluciones (las entradas y ajustes
//                  no son consumo).

/** Días promedio de un mes (365,25 / 12). */
export const DIAS_MES = 30.4375
const MS_DIA = 86_400_000

/** Meses con menos días observados que esto no se usan para tasas ni tendencia. */
export const MIN_DIAS_MES = 7

/** Tipos de movimiento que cuentan como consumo (+) o lo revierten (−). */
export function signoConsumo(tipo: string): 1 | -1 | 0 {
  if (tipo === 'SALIDA' || tipo === 'TRASLADO') return 1
  if (tipo === 'DEVOLUCION') return -1
  return 0
}

// ─── Ventana de meses ─────────────────────────────────────────────────────────

export interface Mes {
  /** 'AAAA-MM' */
  clave: string
  /** 'sep 2026' */
  etiqueta: string
  inicio: Date
  /** Inicio del mes siguiente (exclusivo). */
  fin: Date
  /** Días del mes con datos: desde el inicio de los datos y hasta hoy. */
  diasObservados: number
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function claveMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Los últimos `n` meses calendario terminando en el mes de `hoy` (el mes en
 * curso va parcial). `inicioDatos` recorta los días observados: antes de esa
 * fecha el sistema no registraba consumos, así que esos días no cuentan como
 * "consumo cero".
 */
export function ventanaMeses(hoy: Date, n: number, inicioDatos: Date | null = null): Mes[] {
  const meses: Mes[] = []
  for (let i = n - 1; i >= 0; i--) {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1)
    const desde = Math.max(inicio.getTime(), inicioDatos ? inicioDatos.getTime() : -Infinity)
    const hasta = Math.min(fin.getTime(), hoy.getTime())
    meses.push({
      clave: claveMes(inicio),
      etiqueta: `${MESES_CORTOS[inicio.getMonth()]} ${inicio.getFullYear()}`,
      inicio,
      fin,
      diasObservados: Math.max(0, (hasta - desde) / MS_DIA),
    })
  }
  return meses
}

/**
 * Fecha desde la que hay datos confiables: el primer mes cuyo número de
 * movimientos llega al `umbral` (25 %) del mes más activo. Evita que el mes de
 * arranque del sistema (con un puñado de registros de prueba) se lea como
 * "consumo casi cero" y dispare una tendencia falsa.
 */
export function detectarInicioDatos(conteoPorMes: Map<string, number>, umbral = 0.25): Date | null {
  const claves = [...conteoPorMes.keys()].sort()
  if (claves.length === 0) return null
  const max = Math.max(...conteoPorMes.values())
  if (max <= 0) return null
  const primera = claves.find(k => (conteoPorMes.get(k) ?? 0) >= max * umbral) ?? claves[0]
  const [a, m] = primera.split('-').map(Number)
  return new Date(a, m - 1, 1)
}

// ─── Consumo por mes ──────────────────────────────────────────────────────────

export interface MovConsumo {
  productoId: string
  tipo: string
  cantidad: number
  /** ISO 8601 */
  fecha: string
}

export interface ConsumoProducto {
  salidas: number[]
  devoluciones: number[]
  /** salidas − devoluciones, por mes (alineado con la ventana). */
  neto: number[]
}

/** Suma el consumo de cada producto en cada mes de la ventana. */
export function consumoPorMes(movs: readonly MovConsumo[], meses: readonly Mes[]): Map<string, ConsumoProducto> {
  const indice = new Map(meses.map((m, i) => [m.clave, i]))
  const res = new Map<string, ConsumoProducto>()
  for (const mv of movs) {
    const s = signoConsumo(mv.tipo)
    if (s === 0) continue
    const d = new Date(mv.fecha)
    if (isNaN(d.getTime())) continue
    const i = indice.get(claveMes(d))
    if (i === undefined) continue
    let c = res.get(mv.productoId)
    if (!c) {
      c = { salidas: meses.map(() => 0), devoluciones: meses.map(() => 0), neto: meses.map(() => 0) }
      res.set(mv.productoId, c)
    }
    const q = Math.abs(Number(mv.cantidad) || 0)
    if (s > 0) c.salidas[i] += q
    else c.devoluciones[i] += q
    c.neto[i] += s * q
  }
  return res
}

// ─── Estadística ──────────────────────────────────────────────────────────────

export function media(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Desviación estándar muestral (n − 1). null con menos de 2 datos. */
export function desviacionEstandar(xs: readonly number[]): number | null {
  if (xs.length < 2) return null
  const m = media(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

export interface Regresion {
  pendiente: number
  intercepto: number
  /** Coeficiente de determinación; null con menos de 3 puntos (2 puntos siempre dan 1). */
  r2: number | null
}

/** Mínimos cuadrados de y sobre x = 0, 1, 2… null con menos de 2 puntos. */
export function regresionLineal(ys: readonly number[]): Regresion | null {
  const n = ys.length
  if (n < 2) return null
  const mx = (n - 1) / 2
  const my = media(ys)
  let sxy = 0, sxx = 0, syy = 0
  ys.forEach((y, x) => {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  })
  const pendiente = sxx === 0 ? 0 : sxy / sxx
  const intercepto = my - pendiente * mx
  const r2 = n < 3 ? null : syy === 0 ? 1 : (sxy * sxy) / (sxx * syy)
  return { pendiente, intercepto, r2 }
}

// ─── Proyección por producto ──────────────────────────────────────────────────

export type EstadoProyeccion = 'NEGATIVO' | 'AGOTADO' | 'CRÍTICO' | 'BAJO' | 'OK' | 'SIN CONSUMO'

export interface EntradaProyeccion {
  disponible: number
  /** Consumo neto por mes, alineado con `meses`. */
  neto: readonly number[]
  meses: readonly Mes[]
  hoy: Date
  /** Días que debe cubrir la compra sugerida (30, 60…). */
  diasCompra: number
  /** Meses a proyectar (3 por defecto). */
  horizonte?: number
  /** Por debajo de estos días de cobertura el producto es CRÍTICO. */
  diasCriticos?: number
}

export interface ResultadoProyeccion {
  /** Tasa mensual de cada mes válido (normalizada a 30,4 días). */
  tasasMensuales: number[]
  mesesValidos: number
  consumoTotal: number
  consumoDiario: number
  consumoMensual: number
  desviacion: number | null
  /** Coeficiente de variación (desviación / media). */
  coefVariacion: number | null
  /** Unidades/mes que sube (+) o baja (−) el consumo cada mes. */
  tendencia: number | null
  /** Tendencia relativa al consumo mensual promedio. */
  tendenciaPct: number | null
  r2: number | null
  /** Días que alcanza lo disponible. 0 si ya no hay; null si no hay consumo. */
  diasCobertura: number | null
  fechaAgotamiento: Date | null
  sugerido: number
  /** Consumo proyectado para cada uno de los próximos meses. */
  consumoProyectado: number[]
  /** Stock disponible al cierre de cada uno de los próximos meses, sin entradas. */
  stockProyectado: number[]
  /** true si la proyección usó la recta de tendencia (≥ 3 meses válidos). */
  usaTendencia: boolean
  estado: EstadoProyeccion
}

export function proyectarProducto(e: EntradaProyeccion): ResultadoProyeccion {
  const horizonte = e.horizonte ?? 3
  const diasCriticos = e.diasCriticos ?? 15

  const validos = e.meses
    .map((m, i) => ({ m, neto: e.neto[i] ?? 0 }))
    .filter(x => x.m.diasObservados >= MIN_DIAS_MES)
  const dias = validos.reduce((a, x) => a + x.m.diasObservados, 0)
  const consumoTotal = validos.reduce((a, x) => a + x.neto, 0)
  const tasas = validos.map(x => (x.neto / x.m.diasObservados) * DIAS_MES)

  const consumoDiario = dias > 0 ? Math.max(0, consumoTotal / dias) : 0
  const consumoMensual = consumoDiario * DIAS_MES
  const desviacion = desviacionEstandar(tasas)
  const mTasas = media(tasas)
  const coefVariacion = desviacion !== null && mTasas > 0 ? desviacion / mTasas : null

  const reg = regresionLineal(tasas)
  const tendencia = reg ? reg.pendiente : null
  const tendenciaPct = reg && consumoMensual > 0 ? reg.pendiente / consumoMensual : null
  const usaTendencia = !!reg && tasas.length >= 3

  const consumoProyectado: number[] = []
  for (let k = 1; k <= horizonte; k++) {
    consumoProyectado.push(
      usaTendencia && reg ? Math.max(0, reg.intercepto + reg.pendiente * (tasas.length - 1 + k)) : consumoMensual,
    )
  }
  const stockProyectado: number[] = []
  let saldo = e.disponible
  for (const c of consumoProyectado) {
    saldo -= c
    stockProyectado.push(saldo)
  }

  const diasCobertura = e.disponible <= 0 ? 0 : consumoDiario > 0 ? e.disponible / consumoDiario : null
  const fechaAgotamiento = diasCobertura === null ? null : new Date(e.hoy.getTime() + diasCobertura * MS_DIA)
  const sugerido = Math.max(0, consumoDiario * e.diasCompra - e.disponible)

  let estado: EstadoProyeccion
  if (e.disponible < 0) estado = 'NEGATIVO'
  else if (e.disponible === 0) estado = consumoDiario > 0 ? 'AGOTADO' : 'SIN CONSUMO'
  else if (consumoDiario <= 0) estado = 'SIN CONSUMO'
  else if ((diasCobertura ?? Infinity) < diasCriticos) estado = 'CRÍTICO'
  else if ((diasCobertura ?? Infinity) < e.diasCompra) estado = 'BAJO'
  else estado = 'OK'

  return {
    tasasMensuales: tasas,
    mesesValidos: tasas.length,
    consumoTotal,
    consumoDiario,
    consumoMensual,
    desviacion,
    coefVariacion,
    tendencia,
    tendenciaPct,
    r2: reg?.r2 ?? null,
    diasCobertura,
    fechaAgotamiento,
    sugerido,
    consumoProyectado,
    stockProyectado,
    usaTendencia,
    estado,
  }
}
