// Análisis entre meses del arqueo: une en una sola línea de tiempo los conteos
// hechos EN LA PLATAFORMA (arqueos / arqueo_items) y los cargados POR EXCEL
// (inventarios_fisicos / inventario_fisico_items), y los compara.
// Lógica pura: sin React ni Supabase, sirve en cliente y servidor.

import { resolverClaves, type InventarioFisico, type ItemFisico } from '@/lib/inventario-fisico'
import { compararItem } from '@/lib/reportes/orden'

export type FuenteConteo = 'PLATAFORMA' | 'CARGUE'
export type EstadoArqueo = 'ABIERTO' | 'CERRADO' | 'ANULADO'

export interface ItemConteo {
  producto_id: string | null
  codigo: number | null
  nombre: string
  presentacion: string | null
  contado: number
  /** Lo que decía el sistema al momento del conteo (null = no se conocía). */
  sistema: number | null
  /** contado − sistema (null si no se conocía el sistema). */
  diferencia: number | null
  precio: number | null
}

export interface Conteo {
  fuente: FuenteConteo
  id: string
  nombre: string
  /** Fecha del conteo en ISO (inicio del arqueo o fecha de corte del cargue). */
  fecha: string
  /** 'YYYY-MM' en hora de Colombia. */
  mes: string
  /** Solo arqueos de plataforma. */
  estado: EstadoArqueo | null
  /** true = arqueo abierto: solo se toman los ítems ya contados. */
  parcial: boolean
  /** Ítems en el alcance del conteo (arqueo: total_items; cargue: filas del archivo). */
  alcance: number
  items: ItemConteo[]
  /**
   * Cargue masivo: productos que vinieron en el archivo con la celda vacía.
   * No son 0 ni "dejaron de aparecer": vinieron, pero no se sabe la cantidad.
   */
  sinCantidad: ProductoRef[]
}

export type ProductoRef = Pick<ItemConteo, 'producto_id' | 'codigo' | 'nombre' | 'presentacion'>

// ── Adaptadores ─────────────────────────────────────────────────────────────

export interface ArqueoFila {
  id: string
  nombre: string
  estado: EstadoArqueo
  total_items: number
  created_at: string
  cerrado_at: string | null
}

export interface ArqueoItemFila {
  arqueo_id: string
  producto_id: string
  cantidad_sistema: number
  cantidad_fisica: number | null
  estado: 'PENDIENTE' | 'CONTADO' | 'AJUSTADO'
  precio_lista: number | null
  codigo: number | null
  nombre: string
  presentacion: string | null
}

const TZ = 'America/Bogota'

/** 'YYYY-MM' de una fecha (ISO con hora → hora de Colombia; 'YYYY-MM-DD' tal cual). */
export function mesDe(fecha: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha.slice(0, 7)
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(fecha))
  const y = partes.find(p => p.type === 'year')!.value
  const m = partes.find(p => p.type === 'month')!.value
  return `${y}-${m}`
}

/** Milisegundos para ordenar (una fecha sin hora se toma al mediodía de Colombia). */
export function instante(fecha: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T12:00:00-05:00` : fecha)
}

export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Arqueo de plataforma → Conteo. Solo entran los ítems contados (CONTADO/AJUSTADO). */
export function conteoDeArqueo(a: ArqueoFila, items: ArqueoItemFila[]): Conteo {
  return {
    fuente: 'PLATAFORMA',
    id: a.id,
    nombre: a.nombre,
    fecha: a.created_at,
    mes: mesDe(a.created_at),
    estado: a.estado,
    parcial: a.estado === 'ABIERTO',
    alcance: a.total_items,
    sinCantidad: [],
    items: ordenarItems(items
      .filter(i => i.arqueo_id === a.id && i.estado !== 'PENDIENTE' && i.cantidad_fisica !== null)
      .map(i => ({
        producto_id: i.producto_id,
        codigo: i.codigo,
        nombre: i.nombre,
        presentacion: i.presentacion,
        contado: Number(i.cantidad_fisica),
        sistema: Number(i.cantidad_sistema),
        diferencia: Number(i.cantidad_fisica) - Number(i.cantidad_sistema),
        precio: i.precio_lista,
      }))),
  }
}

/**
 * Cargue masivo → Conteo. En `items` entran las filas con cantidad (CONTADO);
 * las de celda vacía (SIN_CANTIDAD) van aparte en `sinCantidad` para que no
 * se lean como 0 ni como "dejó de aparecer". Los NO_HALLADO no entran: no
 * vinieron en el archivo.
 */
export function conteoDeCargue(inv: InventarioFisico, items: ItemFisico[]): Conteo {
  return {
    fuente: 'CARGUE',
    id: inv.id,
    nombre: inv.periodo,
    fecha: inv.fecha_corte,
    mes: mesDe(inv.fecha_corte),
    estado: null,
    parcial: false,
    alcance: inv.total_items,
    sinCantidad: ordenarItems(items
      .filter(i => i.inventario_id === inv.id && (i.estado === 'SIN_CANTIDAD' || (i.estado === 'CONTADO' && i.cantidad_contada === null)))
      .map(i => ({ producto_id: i.producto_id, codigo: i.codigo, nombre: i.nombre, presentacion: i.presentacion }))),
    items: ordenarItems(items
      .filter(i => i.inventario_id === inv.id && i.estado === 'CONTADO' && i.cantidad_contada !== null)
      .map(i => ({
        producto_id: i.producto_id,
        codigo: i.codigo,
        nombre: i.nombre,
        presentacion: i.presentacion,
        contado: i.cantidad_contada!,
        sistema: i.stock_sistema,
        diferencia: i.stock_sistema === null ? null : i.cantidad_contada! - i.stock_sistema,
        precio: i.precio_unitario,
      }))),
  }
}

/** Todos los conteos en orden cronológico ascendente. */
export function lineaDeTiempo(conteos: Conteo[]): Conteo[] {
  return [...conteos].sort((a, b) => instante(a.fecha) - instante(b.fecha) || a.nombre.localeCompare(b.nombre))
}

// ── Orden estándar: ítem (código) asc, sin código al final, luego nombre ────

export function compararProducto(
  a: { codigo: number | null; nombre: string },
  b: { codigo: number | null; nombre: string },
): number {
  // El mismo criterio de todos los reportes (lib/reportes/orden.ts)
  return compararItem(a.codigo, a.nombre, b.codigo, b.nombre)
}

export function ordenarItems<T extends { codigo: number | null; nombre: string }>(l: T[]): T[] {
  return [...l].sort(compararProducto)
}

/**
 * Clave de un producto entre conteos: id; si no hay, código; si no, nombre.
 * Para cruzar conteos usa `clavesDe(conteos)`: una fila de cargue sin
 * producto_id (producto borrado después) toma el id que ese código tiene en
 * los demás conteos; con la clave suelta no casaría con su propio historial.
 */
export const claveProducto = (i: Pick<ItemConteo, 'producto_id' | 'codigo' | 'nombre'>) =>
  i.producto_id ?? (i.codigo !== null ? `c:${i.codigo}` : `n:${i.nombre.trim().toUpperCase()}`)

/** Función de clave común para cruzar varios conteos entre sí. */
export function clavesDe(conteos: readonly Conteo[]): (i: ProductoRef) => string {
  return resolverClaves<ProductoRef>(...conteos.flatMap(c => [c.items, c.sinCantidad]))
}

// ── Métricas de un conteo ───────────────────────────────────────────────────

export interface Metricas {
  contados: number
  unidades: number
  /** Ítems con sistema conocido (base de la exactitud). */
  comparables: number
  cuadran: number
  faltantes: number
  sobrantes: number
  unidadesFaltantes: number
  unidadesSobrantes: number
  valorFaltantes: number
  valorSobrantes: number
  /** Neto (faltantes negativos + sobrantes positivos). */
  valorNeto: number
  /** cuadran / comparables × 100 (null si no hay comparables). */
  exactitud: number | null
}

export function metricas(items: ItemConteo[]): Metricas {
  const m: Metricas = {
    contados: items.length, unidades: 0, comparables: 0, cuadran: 0, faltantes: 0, sobrantes: 0,
    unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltantes: 0, valorSobrantes: 0, valorNeto: 0, exactitud: null,
  }
  for (const i of items) {
    m.unidades += i.contado
    if (i.diferencia === null) continue
    m.comparables++
    const valor = i.diferencia * (i.precio ?? 0)
    if (i.diferencia === 0) m.cuadran++
    else if (i.diferencia < 0) { m.faltantes++; m.unidadesFaltantes += i.diferencia; m.valorFaltantes += valor }
    else { m.sobrantes++; m.unidadesSobrantes += i.diferencia; m.valorSobrantes += valor }
  }
  m.valorNeto = m.valorFaltantes + m.valorSobrantes
  m.exactitud = m.comparables ? (m.cuadran / m.comparables) * 100 : null
  return m
}

// ── Resumen por mes ─────────────────────────────────────────────────────────

export interface ResumenMes {
  mes: string
  etiqueta: string
  conteos: { conteo: Conteo; m: Metricas }[]
  /** Todos los conteos del mes sumados. */
  total: Metricas
}

/** Meses del más reciente al más antiguo; dentro del mes, conteos por fecha. */
export function resumenPorMes(conteos: Conteo[]): ResumenMes[] {
  const meses = new Map<string, Conteo[]>()
  for (const c of lineaDeTiempo(conteos)) {
    const l = meses.get(c.mes)
    if (l) l.push(c)
    else meses.set(c.mes, [c])
  }
  return [...meses.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mes, lista]) => ({
      mes,
      etiqueta: etiquetaMes(mes),
      conteos: lista.map(conteo => ({ conteo, m: metricas(conteo.items) })),
      total: metricas(lista.flatMap(c => c.items)),
    }))
}

// ── Comparar dos conteos cualesquiera ───────────────────────────────────────

export type EstadoCambio = 'FALTANTE' | 'NUEVO' | 'AGOTADO' | 'BAJO' | 'SUBIO' | 'IGUAL' | 'SIN_COMPARAR' | 'SIN_CANTIDAD'

export const ETIQUETA_CAMBIO: Record<EstadoCambio, string> = {
  FALTANTE: 'Dejó de aparecer',
  NUEVO: 'Nuevo',
  AGOTADO: 'Se agotó',
  BAJO: 'Bajó',
  SUBIO: 'Subió',
  IGUAL: 'Igual',
  SIN_COMPARAR: 'Falta contarlo en el parcial',
  SIN_CANTIDAD: 'Vino sin cantidad',
}

export interface FilaCambio {
  clave: string
  codigo: number | null
  nombre: string
  presentacion: string | null
  /** Contado en A / en B (null = no se contó en ese conteo). */
  a: number | null
  b: number | null
  /**
   * B − A. Un producto que no aparece en un conteo completo cuenta como 0;
   * si falta en un arqueo abierto (parcial) no se sabe: null.
   */
  diferencia: number | null
  porcentaje: number | null
  /** Diferencia contra el sistema en cada conteo. */
  difSistemaA: number | null
  difSistemaB: number | null
  precio: number | null
  valor: number | null
  estado: EstadoCambio
}

function estadoCambio(a: number | null, b: number | null, parcialA: boolean, parcialB: boolean): EstadoCambio {
  if ((a === null && parcialA) || (b === null && parcialB)) return 'SIN_COMPARAR'
  if (a !== null && b === null) return 'FALTANTE'
  if (a === null) return 'NUEVO'
  if (a > 0 && b === 0) return 'AGOTADO'
  if (b! < a) return 'BAJO'
  if (b! > a) return 'SUBIO'
  return 'IGUAL'
}

/** A = conteo anterior, B = conteo actual. Ordenado por ítem y nombre. */
export function compararDosConteos(A: Conteo, B: Conteo): FilaCambio[] {
  const clave = clavesDe([A, B])
  const mapA = new Map(A.items.map(i => [clave(i), i]))
  const mapB = new Map(B.items.map(i => [clave(i), i]))
  // Vinieron en el archivo con la celda vacía: no se sabe la cantidad
  const vaciasA = new Map(A.sinCantidad.map(i => [clave(i), i]))
  const vaciasB = new Map(B.sinCantidad.map(i => [clave(i), i]))
  const filas: FilaCambio[] = []
  for (const k of new Set([...mapA.keys(), ...mapB.keys(), ...vaciasA.keys(), ...vaciasB.keys()])) {
    const ia = mapA.get(k)
    const ib = mapB.get(k)
    // Vacío en uno y ausente o vacío en el otro: no hay nada que comparar
    if (!ia && !ib) continue
    const ref = ib ?? ia!
    const a = ia ? ia.contado : null
    const b = ib ? ib.contado : null
    const vacia = (!ia && vaciasA.has(k)) || (!ib && vaciasB.has(k))
    const estado: EstadoCambio = vacia ? 'SIN_CANTIDAD' : estadoCambio(a, b, A.parcial, B.parcial)
    const diferencia = estado === 'SIN_COMPARAR' || estado === 'SIN_CANTIDAD' ? null : (b ?? 0) - (a ?? 0)
    const precio = ib?.precio ?? ia?.precio ?? null
    filas.push({
      clave: k,
      codigo: ref.codigo,
      nombre: ref.nombre,
      presentacion: ref.presentacion,
      a, b, diferencia,
      porcentaje: a && diferencia !== null ? (diferencia / a) * 100 : null,
      difSistemaA: ia?.diferencia ?? null,
      difSistemaB: ib?.diferencia ?? null,
      precio,
      valor: precio && diferencia !== null ? diferencia * precio : null,
      estado,
    })
  }
  return ordenarItems(filas)
}

export function resumenCambios(filas: FilaCambio[]) {
  const n = (e: EstadoCambio) => filas.filter(f => f.estado === e).length
  return {
    FALTANTE: n('FALTANTE'), NUEVO: n('NUEVO'), AGOTADO: n('AGOTADO'),
    BAJO: n('BAJO'), SUBIO: n('SUBIO'), IGUAL: n('IGUAL'), SIN_COMPARAR: n('SIN_COMPARAR'),
    SIN_CANTIDAD: n('SIN_CANTIDAD'),
    enAmbos: filas.filter(f => f.a !== null && f.b !== null).length,
    // Las unidades solo se suman en lo comparable (no en lo que falta contar en
    // un parcial ni en lo que vino sin cantidad)
    unidadesA: filas.reduce((s, f) => s + (f.estado === 'SIN_COMPARAR' || f.estado === 'SIN_CANTIDAD' ? 0 : f.a ?? 0), 0),
    unidadesB: filas.reduce((s, f) => s + (f.estado === 'SIN_COMPARAR' || f.estado === 'SIN_CANTIDAD' ? 0 : f.b ?? 0), 0),
    valorBajas: filas.reduce((s, f) => s + (f.valor !== null && f.valor < 0 ? f.valor : 0), 0),
    valorAlzas: filas.reduce((s, f) => s + (f.valor !== null && f.valor > 0 ? f.valor : 0), 0),
  }
}

/** Par por defecto: el último conteo con ítems vs el anterior con ítems. */
export function parPorDefecto(conteos: Conteo[]): [string, string] | null {
  const conItems = lineaDeTiempo(conteos).filter(c => c.items.length > 0)
  if (conItems.length < 2) return null
  return [conItems[conItems.length - 2].id, conItems[conItems.length - 1].id]
}

// ── Matriz producto × conteo (diferencia contra el sistema) ─────────────────

export interface CeldaMatriz { contado: number; sistema: number | null; diferencia: number | null }

export interface FilaMatriz {
  clave: string
  codigo: number | null
  nombre: string
  presentacion: string | null
  celdas: Record<string, CeldaMatriz>
  /** Conteos (id) en que vino en el archivo con la celda vacía. */
  vacias: string[]
  /** En cuántos conteos se contó. */
  veces: number
  /** En cuántos conteos tuvo diferencia ≠ 0 contra el sistema. */
  conDiferencia: number
  /** Suma de las diferencias (unidades). */
  acumulado: number
}

/** `conteos` en orden cronológico (las columnas). */
export function matrizConteos(conteos: Conteo[]): FilaMatriz[] {
  const filas = new Map<string, FilaMatriz>()
  const claveDe = clavesDe(conteos)
  const fila = (it: ProductoRef) => {
    const clave = claveDe(it)
    let f = filas.get(clave)
    if (!f) {
      f = { clave, codigo: it.codigo, nombre: it.nombre, presentacion: it.presentacion, celdas: {}, vacias: [], veces: 0, conDiferencia: 0, acumulado: 0 }
      filas.set(clave, f)
    }
    return f
  }
  for (const c of conteos) {
    for (const it of c.sinCantidad) fila(it).vacias.push(c.id)
    for (const it of c.items) {
      const f = fila(it)
      if (c.id in f.celdas) continue // la misma clave dos veces en un conteo no se cuenta doble
      // El nombre del conteo más reciente es el que manda
      f.codigo = it.codigo ?? f.codigo
      f.nombre = it.nombre
      f.presentacion = it.presentacion
      f.celdas[c.id] = { contado: it.contado, sistema: it.sistema, diferencia: it.diferencia }
      f.veces++
      if (it.diferencia !== null && it.diferencia !== 0) {
        f.conDiferencia++
        f.acumulado += it.diferencia
      }
    }
  }
  return ordenarItems([...filas.values()])
}

// ── Serie por mes para la gráfica (cronológica ascendente) ──────────────────

export function seriePorMes(conteos: Conteo[]) {
  return resumenPorMes(conteos)
    .filter(r => r.total.contados > 0)
    .reverse()
    .map(r => ({
      mes: r.mes,
      etiqueta: r.etiqueta,
      exactitud: r.total.exactitud === null ? null : Math.round(r.total.exactitud * 10) / 10,
      faltantes: Math.round(r.total.valorFaltantes),
      sobrantes: Math.round(r.total.valorSobrantes),
      neto: Math.round(r.total.valorNeto),
    }))
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

const plano = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function coincideBusqueda(busca: string, codigo: number | null, nombre: string): boolean {
  const b = plano(busca.trim())
  return !b || String(codigo ?? '').startsWith(b) || plano(nombre).includes(b)
}
