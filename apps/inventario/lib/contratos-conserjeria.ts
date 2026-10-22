// Lógica pura del contrato de conserjería (F1 del módulo de Puntos QR).
// El contrato es una fila de `grupos_contrato`; la pantalla está en
// /rondas/contratos y NO es la de /contratos, que clasifica sedes para
// inventario. Ver docs/puntos-qr-whatsapp/03-nomenclatura.md.
//
// `vigenciaFin` y `estaVigente` son el espejo en TypeScript de las funciones
// `grupo_vigencia_fin()` y `grupo_vigente()` de la migración
// 20261019000010_puntos_qr_f1_contrato.sql. Se duplican a propósito: la base es
// la que manda (la consultan los QR y las visitas), y esto es solo para pintar
// el estado en la pantalla sin una consulta por fila. Si una cambia, cambian
// las dos, y lo vigila `scripts/probar-vigencia-paridad.mjs`, que corre los
// mismos 11 casos contra la base y contra estas funciones.

export type EstadoContrato = 'BORRADOR' | 'VIGENTE' | 'SUSPENDIDO' | 'VENCIDO' | 'TERMINADO'
export type ServicioContrato = 'ASEO' | 'CONSERJERIA' | 'MANTENIMIENTO' | 'SEGURIDAD'
export type TipoVigencia = 'INICIAL' | 'PRORROGA' | 'RENOVACION' | 'OTROSI'
export type PapelContrato = 'SUPERVISOR' | 'COORDINADOR' | 'TECNICO' | 'CLIENTE' | 'PROVEEDOR'

export const ESTADO_META: Record<EstadoContrato, { label: string; badge: string }> = {
  BORRADOR:   { label: 'Borrador',   badge: 'bg-gray-100 text-gray-600' },
  VIGENTE:    { label: 'Vigente',    badge: 'bg-emerald-100 text-emerald-700' },
  SUSPENDIDO: { label: 'Suspendido', badge: 'bg-amber-100 text-amber-700' },
  VENCIDO:    { label: 'Vencido',    badge: 'bg-red-100 text-red-700' },
  TERMINADO:  { label: 'Terminado',  badge: 'bg-gray-200 text-gray-700' },
}
export const ESTADOS_CONTRATO = Object.keys(ESTADO_META) as EstadoContrato[]

export const SERVICIO_LABEL: Record<ServicioContrato, string> = {
  ASEO: 'Aseo',
  CONSERJERIA: 'Conserjería',
  MANTENIMIENTO: 'Mantenimiento',
  SEGURIDAD: 'Seguridad',
}
export const SERVICIOS_CONTRATO = Object.keys(SERVICIO_LABEL) as ServicioContrato[]

export const TIPO_VIGENCIA_LABEL: Record<TipoVigencia, string> = {
  INICIAL: 'Periodo inicial',
  PRORROGA: 'Prórroga',
  RENOVACION: 'Renovación',
  OTROSI: 'Otrosí',
}
export const TIPOS_VIGENCIA = Object.keys(TIPO_VIGENCIA_LABEL) as TipoVigencia[]

export const PAPEL_LABEL: Record<PapelContrato, string> = {
  SUPERVISOR: 'Supervisor',
  COORDINADOR: 'Coordinador',
  TECNICO: 'Técnico',
  CLIENTE: 'Cliente',
  PROVEEDOR: 'Proveedor',
}

export interface ContratoFila {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  objeto: string | null
  numero: string | null
  cliente_id: string | null
  cliente_nombre: string | null
  estado: EstadoContrato
  vigencia_desde: string | null
  vigencia_hasta: string | null
  idioma_reportes: string
  arte_color: string | null
  arte_logo_path: string | null
  activo: boolean
  servicios: ServicioContrato[]
  sedes: number
}

export interface VigenciaFila {
  id: string
  grupo_id: string
  desde: string
  hasta: string | null
  tipo: TipoVigencia
  motivo: string | null
}

export interface ReglasContrato {
  grupo_id: string
  nivel_antifraude: string | null
  permite_whatsapp: boolean
  pqrs_publico: boolean
  comparte_seguimiento_vivo: boolean
  mensajeria_desde: string | null
  mensajeria_hasta: string | null
  retencion_evidencia_meses: number
  geocerca_radio_m: number
}

/** Valores por defecto de las reglas, iguales a los DEFAULT de la migración. */
export const REGLAS_POR_DEFECTO: Omit<ReglasContrato, 'grupo_id'> = {
  nivel_antifraude: null,
  permite_whatsapp: false,
  pqrs_publico: false,
  comparte_seguimiento_vivo: false,
  mensajeria_desde: null,
  mensajeria_hasta: null,
  retencion_evidencia_meses: 12,
  geocerca_radio_m: 50,
}

/**
 * Fin de la vigencia efectiva: el más tardío entre la fecha del contrato y el
 * `hasta` de sus periodos. `null` = no termina (ni el contrato ni algún periodo
 * tienen fecha de fin).
 */
export function vigenciaFin(
  contrato: Pick<ContratoFila, 'vigencia_hasta'>,
  periodos: Pick<VigenciaFila, 'hasta'>[] = [],
): string | null {
  if (!contrato.vigencia_hasta) return null
  if (periodos.some((p) => !p.hasta)) return null
  const fechas = [contrato.vigencia_hasta, ...periodos.map((p) => p.hasta as string)]
  return fechas.reduce((a, b) => (a >= b ? a : b))
}

/** ¿El contrato está vigente en la fecha dada (ISO `YYYY-MM-DD`)? */
export function estaVigente(
  contrato: Pick<ContratoFila, 'estado' | 'activo' | 'vigencia_desde' | 'vigencia_hasta'>,
  periodos: Pick<VigenciaFila, 'desde' | 'hasta'>[] = [],
  hoy: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (contrato.estado !== 'VIGENTE' || !contrato.activo) return false
  const inicio = vigenciaInicio(contrato, periodos)
  if (inicio && inicio > hoy) return false
  const fin = vigenciaFin(contrato, periodos)
  if (fin && fin < hoy) return false
  return true
}

/**
 * Inicio de la vigencia efectiva: el más temprano entre la fecha del contrato y
 * el `desde` de sus periodos. `null` = sin fecha de inicio pactada. Es el mismo
 * `LEAST(...)` que usa `grupo_vigente()`, así que un periodo con fecha de
 * inicio cuenta aunque la fila del contrato no tenga ninguna.
 */
export function vigenciaInicio(
  contrato: Pick<ContratoFila, 'vigencia_desde'>,
  periodos: Pick<VigenciaFila, 'desde'>[] = [],
): string | null {
  const inicios = [contrato.vigencia_desde, ...periodos.map((p) => p.desde)].filter(Boolean) as string[]
  return inicios.length ? inicios.reduce((a, b) => (a <= b ? a : b)) : null
}

/** Texto corto de la vigencia para el listado. */
export function textoVigencia(
  contrato: Pick<ContratoFila, 'vigencia_desde' | 'vigencia_hasta'>,
  periodos: Pick<VigenciaFila, 'desde' | 'hasta'>[] = [],
): string {
  const inicio = vigenciaInicio(contrato, periodos)
  const fin = vigenciaFin(contrato, periodos)
  if (!inicio && !fin) return 'Sin fechas'
  return `${inicio ? fechaCorta(inicio) : 'sin inicio'} → ${fin ? fechaCorta(fin) : 'sin fin'}`
}

/**
 * Insignia de estado para la pantalla. No es `ESTADO_META[estado]` a secas
 * porque `activo` es otro eje: `/contratos` da de baja un contrato poniéndole
 * `activo = false` (soft delete, cuando todavía tiene sedes activas), y ese
 * contrato seguiría luciendo un «Vigente» en verde aunque `grupo_vigente()` lo
 * tenga apagado. Si está inactivo, eso es lo que se muestra.
 */
export function insigniaEstado(
  contrato: Pick<ContratoFila, 'estado' | 'activo'>,
): { label: string; badge: string } {
  if (!contrato.activo) return { label: 'Inactivo', badge: 'bg-gray-200 text-gray-700' }
  return ESTADO_META[contrato.estado]
}

/**
 * Por qué un contrato NO está vigente hoy, en una frase, o `null` si sí lo
 * está. Existe porque las dos insignias pueden contradecirse a la vista: el
 * `estado` es la etiqueta administrativa y la vigencia se CALCULA, así que un
 * contrato puede decir «Vigente» y no estar vigente (o decir «Vencido» y
 * mostrar días por delante gracias a una prórroga). Nombrar la condición que
 * falló evita que alguien lea «faltan 163 días» y no entienda por qué sus QR no
 * abren.
 */
export function motivoNoVigente(
  contrato: Pick<ContratoFila, 'estado' | 'activo' | 'vigencia_desde' | 'vigencia_hasta'>,
  periodos: Pick<VigenciaFila, 'desde' | 'hasta'>[] = [],
  hoy: string = new Date().toISOString().slice(0, 10),
): string | null {
  if (!contrato.activo) return 'el contrato está marcado como inactivo'
  if (contrato.estado !== 'VIGENTE') {
    return `su estado es «${ESTADO_META[contrato.estado].label}», y solo opera en «Vigente»`
  }
  const inicio = vigenciaInicio(contrato, periodos)
  if (inicio && inicio > hoy) return `su vigencia empieza el ${fechaCorta(inicio)}`
  const fin = vigenciaFin(contrato, periodos)
  if (fin && fin < hoy) return `su vigencia terminó el ${fechaCorta(fin)}`
  return null
}

/** Fecha ISO a `dd/mm/aaaa`, sin pasar por Date para no correr el día por zona. */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** Días que faltan para el fin de la vigencia (negativo si ya pasó). */
export function diasParaVencer(
  contrato: Pick<ContratoFila, 'vigencia_hasta'>,
  periodos: Pick<VigenciaFila, 'hasta'>[] = [],
  hoy: string = new Date().toISOString().slice(0, 10),
): number | null {
  const fin = vigenciaFin(contrato, periodos)
  if (!fin) return null
  const ms = Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)
  return Math.round(ms / 86400000)
}
