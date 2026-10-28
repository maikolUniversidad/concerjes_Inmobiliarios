// El reloj del SLA de un caso del CRM (F11 de Puntos QR), como LÓGICA PURA.
//
// Por qué existe en TypeScript si ya está en SQL (`crm_sumar_habiles_min` y
// `crm_minutos_habiles` de la migración 20261028001200):
//
//   · En SQL hace falta porque el plazo lo calcula la RPC que abre el caso, y
//     ese camino lo usan la consola Y el bot (que entra con la llave de
//     servicio y no pasa por la pantalla).
//   · En TypeScript hace falta porque la bandeja muestra «te quedan 3 horas
//     hábiles» y eso no se puede pedir a la base por cada fila de la lista —
//     Supabase corta a los 8 segundos. Y porque es lo único que se puede probar
//     con pruebas unitarias: las de este repositorio no tocan la base.
//
// Que haya dos implementaciones de la misma aritmética es un riesgo real: se
// pueden separar. Por eso la tabla de casos vive en UN solo archivo
// (`casos-sla.json`) que leen las dos: la prueba unitaria
// (tests/inventario/crm-sla.test.ts) y `scripts/verificar-crm-f11.mjs`, que
// corre los MISMOS casos contra la función de PostgreSQL. Si alguien cambia una
// de las dos, el script de paridad lo dice.
//
// EL CALENDARIO NO SE DUPLICA: los festivos salen de `pqrs_dias_no_habiles`, la
// tabla que ya comparten PQRS y No conformes. Acá entran como parámetro.

/** Franja hábil y calendario con los que corre un reloj. */
export interface OpcionesHabiles {
  /** Hora de apertura, 'HH:MM'. */
  desdeHora: string
  /** Hora de cierre, 'HH:MM'. Tiene que ser mayor que `desdeHora`. */
  hastaHora: string
  /** Zona IANA. En este módulo siempre 'America/Bogota' en producción. */
  zona: string
  /** Fechas 'AAAA-MM-DD' que NO cuentan (festivos de `pqrs_dias_no_habiles`). */
  noHabiles: readonly string[]
}

export const FRANJA_POR_DEFECTO: OpcionesHabiles = {
  desdeHora: '08:00',
  hastaHora: '17:00',
  zona: 'America/Bogota',
  noHabiles: [],
}

/** Minutos de un día hábil completo con la franja indicada. */
export function minutosPorDia(opc: Pick<OpcionesHabiles, 'desdeHora' | 'hastaHora'>): number {
  return enMinutos(opc.hastaHora) - enMinutos(opc.desdeHora)
}

function enMinutos(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) throw new Error(`Hora inválida: ${hhmm}`)
  return Number(m[1]) * 60 + Number(m[2])
}

/* ──────────────────────── Hora local sin depender de la del servidor ────────
 * El servidor de Vercel corre en UTC y el navegador en la zona de quien mira.
 * Las dos cosas son irrelevantes: la franja hábil es la de Bogotá. Se resuelve
 * con `Intl`, que usa la base de datos de zonas del motor, en vez de sumar
 * cinco horas a mano — que funcionaría para Colombia y se rompería el día que
 * el módulo atienda una zona con horario de verano.
 * ────────────────────────────────────────────────────────────────────────── */

interface PartesLocales { anio: number; mes: number; dia: number; hora: number; minuto: number; segundo: number }

const formateadores = new Map<string, Intl.DateTimeFormat>()

function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formateadores.set(zona, f)
  }
  return f
}

/** Qué hora es, en la zona indicada, en ese instante. */
export function partesLocales(instante: Date, zona: string): PartesLocales {
  const p: Record<string, string> = {}
  for (const parte of formateador(zona).formatToParts(instante)) {
    if (parte.type !== 'literal') p[parte.type] = parte.value
  }
  // `hour12: false` da 24 en vez de 00 en algunos motores.
  const hora = Number(p.hour) % 24
  return {
    anio: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora, minuto: Number(p.minute), segundo: Number(p.second),
  }
}

/** Desfase de la zona respecto de UTC, en minutos, en ese instante. */
function desfaseMin(instante: Date, zona: string): number {
  const p = partesLocales(instante, zona)
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
  return (comoUtc - instante.getTime()) / 60000
}

/**
 * El instante en que, en esa zona, el reloj de pared marca esa fecha y hora.
 *
 * Se resuelve en dos pasos porque el desfase depende del instante y el instante
 * depende del desfase: se estima con el desfase de la primera aproximación y se
 * corrige si cambió (lo que pasa justo en el salto de horario de verano).
 */
export function desdeLocal(
  anio: number, mes: number, dia: number, hora: number, minuto: number, zona: string,
): Date {
  const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto, 0)
  const d1 = desfaseMin(new Date(comoUtc), zona)
  let t = comoUtc - d1 * 60000
  const d2 = desfaseMin(new Date(t), zona)
  if (d2 !== d1) t = comoUtc - d2 * 60000
  return new Date(t)
}

const dosDigitos = (n: number) => String(n).padStart(2, '0')

/** La fecha local 'AAAA-MM-DD' de un instante, para cruzar con el calendario. */
export function fechaLocal(instante: Date, zona: string): string {
  const p = partesLocales(instante, zona)
  return `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}`
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha 'AAAA-MM-DD'. */
function isoDow(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number)
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay() // 0 = domingo
  return dow === 0 ? 7 : dow
}

/** El día siguiente de una fecha 'AAAA-MM-DD'. */
function diaSiguiente(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d + 1))
  return `${t.getUTCFullYear()}-${dosDigitos(t.getUTCMonth() + 1)}-${dosDigitos(t.getUTCDate())}`
}

/** ¿Es día hábil? Lunes a viernes y no estar en el calendario de festivos. */
export function esHabil(fecha: string, noHabiles: ReadonlySet<string> | readonly string[]): boolean {
  if (isoDow(fecha) > 5) return false
  const set = noHabiles instanceof Set ? noHabiles : new Set(noHabiles)
  return !set.has(fecha)
}

/** El instante de 'AAAA-MM-DD' a la hora 'HH:MM' en la zona. */
function instanteDe(fecha: string, hhmm: string, zona: string): Date {
  const [a, m, d] = fecha.split('-').map(Number)
  const min = enMinutos(hhmm)
  return desdeLocal(a, m, d, Math.floor(min / 60), min % 60, zona)
}

const TOPE_VUELTAS = 1000

/**
 * Suma minutos HÁBILES a un instante. Espejo de `crm_sumar_habiles_min()`.
 *
 * Si el instante cae fuera de la franja (de noche, un sábado, un festivo), el
 * reloj arranca cuando abre: nadie tiene que contestar a las tres de la mañana
 * y el plazo tampoco se le come por eso.
 *
 * Devuelve `null` si la franja cruza la medianoche (no soportado: un turno de
 * noche es otra aritmética) o si el plazo pasa de 1.000 días hábiles, igual que
 * la función de PostgreSQL.
 */
export function sumarHabiles(desde: Date, minutos: number, opc: OpcionesHabiles): Date | null {
  const abre = enMinutos(opc.desdeHora)
  const cierra = enMinutos(opc.hastaHora)
  if (abre >= cierra) return null

  const noHabiles = new Set(opc.noHabiles)
  let restan = Math.max(Math.trunc(minutos) || 0, 0)
  let cursor = desde
  let vueltas = 0

  for (;;) {
    if (++vueltas > TOPE_VUELTAS) return null

    const fecha = fechaLocal(cursor, opc.zona)
    if (!esHabil(fecha, noHabiles)) {
      cursor = instanteDe(diaSiguiente(fecha), opc.desdeHora, opc.zona)
      continue
    }

    const ini = instanteDe(fecha, opc.desdeHora, opc.zona)
    const fin = instanteDe(fecha, opc.hastaHora, opc.zona)
    if (cursor < ini) cursor = ini
    if (cursor >= fin) {
      cursor = instanteDe(diaSiguiente(fecha), opc.desdeHora, opc.zona)
      continue
    }

    const cabe = Math.floor((fin.getTime() - cursor.getTime()) / 60000)
    if (restan <= cabe) return new Date(cursor.getTime() + restan * 60000)

    restan -= cabe
    cursor = instanteDe(diaSiguiente(fecha), opc.desdeHora, opc.zona)
  }
}

/**
 * Minutos HÁBILES transcurridos entre dos instantes. Espejo de
 * `crm_minutos_habiles()`.
 *
 * Es lo que se le suma a `pausado_min` cuando el reloj estuvo parado: un caso
 * en espera del viernes a las 16:00 al lunes a las 9:00 estuvo parado 2 horas
 * hábiles, no 65.
 */
export function minutosHabiles(desde: Date, hasta: Date, opc: OpcionesHabiles): number | null {
  const abre = enMinutos(opc.desdeHora)
  const cierra = enMinutos(opc.hastaHora)
  if (abre >= cierra) return null
  if (hasta.getTime() <= desde.getTime()) return 0

  const noHabiles = new Set(opc.noHabiles)
  const ultima = fechaLocal(hasta, opc.zona)
  let fecha = fechaLocal(desde, opc.zona)
  let total = 0
  let vueltas = 0

  while (fecha <= ultima) {
    if (++vueltas > 2000) return null
    if (esHabil(fecha, noHabiles)) {
      const ini = instanteDe(fecha, opc.desdeHora, opc.zona).getTime()
      const fin = instanteDe(fecha, opc.hastaHora, opc.zona).getTime()
      const a = Math.max(desde.getTime(), ini)
      const b = Math.min(hasta.getTime(), fin)
      if (b > a) total += Math.floor((b - a) / 60000)
    }
    fecha = diaSiguiente(fecha)
  }

  return total
}

/* ────────────────────────────── El estado del reloj ──────────────────────── */

/** Una fila de `crm_sla`, con lo que hace falta para leer el reloj. */
export interface SlaEntrada {
  arrancaAt: string | Date
  minutosPrimeraRespuesta: number
  minutosResolucion: number
  horasHabiles: boolean
  jornadaDesde: string
  jornadaHasta: string
  zona: string
  primeraRespuestaAt?: string | Date | null
  resueltoAt?: string | Date | null
  pausadoMin: number
  pausadoDesde?: string | Date | null
}

export interface SlaEstado {
  vencePrimera: Date | null
  venceResolucion: Date | null
  /** Minutos hábiles que faltan para la primera respuesta; null si ya respondió. */
  restaPrimeraMin: number | null
  /** Minutos hábiles que faltan para resolver; null si ya está resuelto. */
  restaResolucionMin: number | null
  enPausa: boolean
  incumplido: boolean
  incumplidoQue: 'PRIMERA' | 'RESOLUCION' | 'AMBOS' | null
}

const aFecha = (v: string | Date | null | undefined): Date | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(v))

/**
 * Lee el reloj de un caso en un momento dado. Pura: `ahora` entra como dato,
 * nunca se consulta el reloj del sistema, porque un cálculo de plazo que
 * depende de `Date.now()` no se puede probar.
 *
 * LA PAUSA, que es la parte que se presta a discusión y por eso está acá
 * escrita una sola vez:
 *   · el plazo de resolución es siempre `arranca + resolución + pausado_min`;
 *   · mientras el reloj está en pausa el caso NO puede quedar incumplido;
 *   · el plazo de PRIMERA respuesta no se pausa nunca, porque contestar por
 *     primera vez no depende de nadie más.
 */
export function leerSla(sla: SlaEntrada, ahora: Date): SlaEstado {
  const opc: OpcionesHabiles = {
    desdeHora: sla.jornadaDesde,
    hastaHora: sla.jornadaHasta,
    zona: sla.zona,
    noHabiles: [],
  }
  return leerSlaCon(sla, ahora, opc)
}

/** Igual que `leerSla` pero con el calendario de festivos ya cargado. */
export function leerSlaCon(sla: SlaEntrada, ahora: Date, opc: OpcionesHabiles): SlaEstado {
  const arranca = aFecha(sla.arrancaAt)!
  const primera = aFecha(sla.primeraRespuestaAt)
  const resuelto = aFecha(sla.resueltoAt)
  const pausadoDesde = aFecha(sla.pausadoDesde)
  const enPausa = pausadoDesde !== null

  const sumar = (min: number) =>
    sla.horasHabiles
      ? sumarHabiles(arranca, min, opc)
      : new Date(arranca.getTime() + min * 60000)

  const vencePrimera = sumar(sla.minutosPrimeraRespuesta)
  const venceResolucion = sumar(sla.minutosResolucion + Math.max(sla.pausadoMin, 0))

  const restante = (vence: Date | null): number | null => {
    if (!vence) return null
    if (!sla.horasHabiles) return Math.floor((vence.getTime() - ahora.getTime()) / 60000)
    // En tiempo hábil, «faltan X minutos» son minutos hábiles, y si ya se pasó,
    // los que lleva de más (en negativo).
    return vence.getTime() >= ahora.getTime()
      ? (minutosHabiles(ahora, vence, opc) ?? 0)
      : -(minutosHabiles(vence, ahora, opc) ?? 0)
  }

  const falloPrimera = primera === null && vencePrimera !== null && vencePrimera <= ahora
  const falloResolucion = resuelto === null && venceResolucion !== null && venceResolucion <= ahora
  // Un reloj parado no vence: si venciera igual, la pausa no serviría de nada.
  const incumplido = !enPausa && (falloPrimera || falloResolucion)

  return {
    vencePrimera,
    venceResolucion,
    restaPrimeraMin: primera === null ? restante(vencePrimera) : null,
    restaResolucionMin: resuelto === null ? restante(venceResolucion) : null,
    enPausa,
    incumplido,
    incumplidoQue: !incumplido ? null
      : falloPrimera && falloResolucion ? 'AMBOS'
      : falloPrimera ? 'PRIMERA' : 'RESOLUCION',
  }
}

/**
 * Cuánto hay que sumarle a `pausado_min` al reanudar un reloj parado. Es la
 * contraparte de lo que hace `crm_caso_estado()` en la base.
 */
export function minutosDePausa(
  pausadoDesde: Date, ahora: Date, horasHabiles: boolean, opc: OpcionesHabiles,
): number {
  if (!horasHabiles) {
    return Math.max(Math.floor((ahora.getTime() - pausadoDesde.getTime()) / 60000), 0)
  }
  return Math.max(minutosHabiles(pausadoDesde, ahora, opc) ?? 0, 0)
}

/** Para pintar el reloj: cuán apretado está. */
export function semaforoSla(estado: SlaEstado): 'VENCIDO' | 'PAUSA' | 'APRETADO' | 'BIEN' {
  if (estado.incumplido) return 'VENCIDO'
  if (estado.enPausa) return 'PAUSA'
  const resta = estado.restaPrimeraMin ?? estado.restaResolucionMin
  if (resta !== null && resta <= 60) return 'APRETADO'
  return 'BIEN'
}

/** «3 h 20 min», «2 días hábiles», «vencido hace 40 min». */
export function formatearMinutos(min: number | null, horasHabiles = true, minDia = 540): string {
  if (min === null) return '—'
  const vencido = min < 0
  const m = Math.abs(min)
  let texto: string
  if (m < 60) {
    texto = `${m} min`
  } else if (!horasHabiles || m < minDia) {
    const h = Math.floor(m / 60)
    const r = m % 60
    texto = r === 0 ? `${h} h` : `${h} h ${r} min`
  } else {
    const d = Math.floor(m / minDia)
    const r = m % minDia
    const h = Math.floor(r / 60)
    // «1 día hábil», no «1 día hábiles»: el adjetivo concuerda con el singular.
    texto = h === 0
      ? `${d} ${d === 1 ? 'día hábil' : 'días hábiles'}`
      : `${d} ${d === 1 ? 'día' : 'días'} y ${h} h hábiles`
  }
  return vencido ? `vencido hace ${texto}` : texto
}
