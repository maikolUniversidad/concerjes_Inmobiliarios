// Informe de un cargue de inventario físico contra TODOS los conteos
// anteriores (por fecha de corte) y contra el stock del sistema.
// Lógica pura: sin React ni Supabase (la usan la pantalla
// /inventario-fisico/[id], el Excel del informe y los scripts de verificación).

import { ordenarPorItem } from '@/lib/reportes/orden'
import {
  compararConteos, resumenComparacion, estadoSistema, diferenciaSistema, indexarConteo,
  ordenCronologico, resolverClaves, vinoEnConteo,
  type EstadoComparacion, type EstadoItem, type EstadoSistema, type FilaComparacion,
  type InventarioFisico, type ItemFisico,
} from '@/lib/inventario-fisico'

/**
 * Qué hubo de un producto en un conteo:
 *  CONTADO       vino en el archivo con cantidad
 *  SIN_CANTIDAD  vino en el archivo con la celda vacía (no es 0: no se sabe)
 *  NO_HALLADO    era un activo del catálogo y no vino en el archivo
 *  AUSENTE       no figura en ese conteo (no existía o no estaba activo)
 */
export type EstadoCelda = EstadoItem | 'AUSENTE'

export interface CeldaConteo {
  estado: EstadoCelda
  cantidad: number | null
  /** Contado − sistema en ese conteo (solo CONTADO). */
  difSistema: number | null
}

const AUSENTE: CeldaConteo = { estado: 'AUSENTE', cantidad: null, difSistema: null }

export interface FilaInforme {
  clave: string
  codigo: number | null
  nombre: string
  presentacion: string | null
  /** Celda por inventario_id: los anteriores y el actual. */
  celdas: Record<string, CeldaConteo>
  actual: CeldaConteo
  /** Contra el conteo anterior inmediato (null si no hay anterior). */
  estadoAnterior: EstadoComparacion | null
  difAnterior: number | null
  /** Promedio de lo contado en los conteos anteriores en que vino con cantidad. */
  promedioAnteriores: number | null
  /** En cuántos conteos anteriores vino con cantidad. */
  vecesContadoAntes: number
  /** Actual − promedio (si dejó de venir cuenta como 0; sin cantidad = null). */
  difPromedio: number | null
  /** Contra el sistema en este conteo (null = no figura en este conteo). */
  stockSistema: number | null
  difSistema: number | null
  estadoSistema: EstadoSistema | null
  precio: number | null
  valorDifSistema: number | null
  valorDifAnterior: number | null
  /** Conteos anteriores en que también tuvo diferencia contra el sistema. */
  difSistemaAntes: number
  /** Diferencia contra el sistema ahora y en al menos un conteo anterior. */
  recurrente: boolean
  /** Último conteo anterior en que vino (id), para los que dejaron de venir. */
  ultimoAnteriorConDato: string | null
}

export interface ResumenSistema {
  contados: number
  faltantes: number
  sobrantes: number
  cuadran: number
  noHallados: number
  sinCantidad: number
  /** Contados sin dato del stock previo (no entran en la exactitud). */
  sinSistema: number
  unidadesFaltantes: number
  unidadesSobrantes: number
  valorFaltantes: number
  valorSobrantes: number
  /** Stock que el sistema tenía de los no hallados, a precio de lista. */
  valorNoHallados: number
  unidadesNoHallados: number
  /** cuadran / (faltantes + sobrantes + cuadran) × 100. */
  exactitud: number | null
}

export interface InformeCargue {
  actual: InventarioFisico
  /** Conteos anteriores al actual, en orden cronológico ascendente. */
  anteriores: InventarioFisico[]
  anteriorInmediato: InventarioFisico | null
  /** Conteos que vienen después del actual (solo para avisar). */
  posteriores: InventarioFisico[]
  filas: FilaInforme[]
  vsAnterior: ReturnType<typeof resumenComparacion> | null
  vsSistema: ResumenSistema
  recurrentes: number
}

const celdaDe = (i: ItemFisico | undefined): CeldaConteo =>
  !i ? AUSENTE : {
    estado: i.estado,
    cantidad: i.estado === 'CONTADO' ? i.cantidad_contada : null,
    difSistema: diferenciaSistema(i),
  }

export function resumenSistema(items: readonly ItemFisico[]): ResumenSistema {
  const r: ResumenSistema = {
    contados: 0, faltantes: 0, sobrantes: 0, cuadran: 0, noHallados: 0, sinCantidad: 0, sinSistema: 0,
    unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltantes: 0, valorSobrantes: 0,
    valorNoHallados: 0, unidadesNoHallados: 0, exactitud: null,
  }
  for (const i of items) {
    const e = estadoSistema(i)
    const d = diferenciaSistema(i) ?? 0
    const p = i.precio_unitario ?? 0
    if (i.estado === 'CONTADO') r.contados++
    if (e === 'FALTANTE') { r.faltantes++; r.unidadesFaltantes += d; r.valorFaltantes += d * p }
    else if (e === 'SOBRANTE') { r.sobrantes++; r.unidadesSobrantes += d; r.valorSobrantes += d * p }
    else if (e === 'CUADRA') r.cuadran++
    else if (e === 'NO_HALLADO') {
      r.noHallados++
      r.unidadesNoHallados += i.stock_sistema ?? 0
      r.valorNoHallados += (i.stock_sistema ?? 0) * p
    } else if (e === 'SIN_SISTEMA') r.sinSistema++
    else r.sinCantidad++
  }
  const base = r.faltantes + r.sobrantes + r.cuadran
  r.exactitud = base ? (r.cuadran / base) * 100 : null
  return r
}

/**
 * Informe del conteo `id` contra todos los conteos con fecha de corte anterior
 * (a igual fecha, los cargados antes). `items` puede traer los de todos los
 * conteos: solo se usan los del actual y sus anteriores.
 */
export function informeCargue(
  inventarios: readonly InventarioFisico[],
  items: readonly ItemFisico[],
  id: string,
): InformeCargue | null {
  const cronologico = ordenCronologico(inventarios)
  const pos = cronologico.findIndex(i => i.id === id)
  if (pos < 0) return null
  const actual = cronologico[pos]
  const anteriores = cronologico.slice(0, pos)
  const posteriores = cronologico.slice(pos + 1)
  const anteriorInmediato = anteriores.length ? anteriores[anteriores.length - 1] : null

  const usados = new Set([...anteriores, actual].map(i => i.id))
  const porConteo = new Map<string, ItemFisico[]>()
  for (const it of items) {
    if (!usados.has(it.inventario_id)) continue
    const l = porConteo.get(it.inventario_id)
    if (l) l.push(it)
    else porConteo.set(it.inventario_id, [it])
  }
  const itemsActual = porConteo.get(actual.id) ?? []
  // Una sola función de clave para todos los conteos del informe
  const clave = resolverClaves(...[...porConteo.values()])
  const indices = new Map([...anteriores, actual].map(inv => [inv.id, indexarConteo(porConteo.get(inv.id) ?? [], clave)]))

  // Contra el anterior inmediato: la misma comparación de la pestaña "Comparar periodos"
  const comparacion = new Map<string, FilaComparacion>()
  let vsAnterior: InformeCargue['vsAnterior'] = null
  if (anteriorInmediato) {
    const filasComp = compararConteos(porConteo.get(anteriorInmediato.id) ?? [], itemsActual, clave)
    for (const f of filasComp) comparacion.set(f.clave, f)
    vsAnterior = resumenComparacion(filasComp)
  }

  // Productos del informe: todo lo del conteo actual (incluidos los no
  // hallados) y lo que vino en algún conteo anterior.
  const claves = new Set<string>(indices.get(actual.id)!.keys())
  for (const inv of anteriores) {
    for (const [k, it] of indices.get(inv.id)!) if (vinoEnConteo(it)) claves.add(k)
  }

  const idxActual = indices.get(actual.id)!
  const filas: FilaInforme[] = []
  for (const k of claves) {
    const celdas: Record<string, CeldaConteo> = {}
    let ref: ItemFisico | undefined
    let ultimoAnteriorConDato: string | null = null
    let suma = 0
    let veces = 0
    let difAntes = 0
    for (const inv of anteriores) {
      const it = indices.get(inv.id)!.get(k)
      const c = celdaDe(it)
      celdas[inv.id] = c
      if (it) ref = it
      if (c.estado === 'CONTADO' || c.estado === 'SIN_CANTIDAD') ultimoAnteriorConDato = inv.id
      if (c.estado === 'CONTADO' && c.cantidad !== null) { suma += c.cantidad; veces++ }
      if (c.difSistema !== null && c.difSistema !== 0) difAntes++
    }
    const itActual = idxActual.get(k)
    const actualCelda = celdaDe(itActual)
    celdas[actual.id] = actualCelda
    if (itActual) ref = itActual
    // El nombre y la presentación del conteo más reciente mandan
    const base = ref!

    const promedio = veces ? suma / veces : null
    const vinoAhora = actualCelda.estado === 'CONTADO' || actualCelda.estado === 'SIN_CANTIDAD'
    const qActual = actualCelda.estado === 'CONTADO' ? actualCelda.cantidad
      : !vinoAhora && veces > 0 ? 0 // dejó de venir: cuenta como 0, igual que en la comparativa
      : null
    const comp = comparacion.get(k) ?? null
    const precio = itActual?.precio_unitario ?? comp?.precio ?? base.precio_unitario ?? null
    const eSis = itActual ? estadoSistema(itActual) : null
    const difSis = actualCelda.difSistema
    const recurrente = (eSis === 'FALTANTE' || eSis === 'SOBRANTE') && difAntes > 0

    filas.push({
      clave: k,
      codigo: base.codigo,
      nombre: base.nombre,
      presentacion: base.presentacion,
      celdas,
      actual: actualCelda,
      estadoAnterior: comp?.estado ?? null,
      difAnterior: comp?.diferencia ?? null,
      promedioAnteriores: promedio,
      vecesContadoAntes: veces,
      difPromedio: qActual !== null && promedio !== null ? qActual - promedio : null,
      stockSistema: itActual?.stock_sistema ?? null,
      difSistema: difSis,
      estadoSistema: eSis,
      precio,
      valorDifSistema: difSis !== null && precio ? difSis * precio : null,
      valorDifAnterior: comp?.valorDiferencia ?? null,
      difSistemaAntes: difAntes,
      recurrente,
      ultimoAnteriorConDato,
    })
  }

  return {
    actual,
    anteriores,
    anteriorInmediato,
    posteriores,
    filas: ordenarPorItem(filas, f => f.codigo, f => f.nombre),
    vsAnterior,
    vsSistema: resumenSistema(itemsActual),
    recurrentes: filas.filter(f => f.recurrente).length,
  }
}
