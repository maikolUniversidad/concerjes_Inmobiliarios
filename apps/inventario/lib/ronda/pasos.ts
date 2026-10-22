// Etiquetas, iconos y textos de los pasos de una plantilla, para la CONSOLA
// (F3 del módulo de Puntos QR).
//
// El CONTRATO de los pasos —qué tipos hay, qué `config` acepta cada uno y qué
// respuesta es válida— se movió en F4 a `packages/ronda-core/src/pasos.ts`,
// porque la PWA del trabajador (React 19) y el módulo de `apps/movil` (React
// 18) tienen que validar IGUAL que la consola: es la decisión §1.1 del
// complemento 2. Aquí se reexporta, así que todo lo que ya importaba de
// `@/lib/ronda/pasos` sigue funcionando; lo que queda en este archivo es lo que
// sí es de la consola (labels, iconos, badges, textos de resumen).
//
// El núcleo sigue siendo el espejo en TypeScript de
// `ronda_paso_config_valida()` de la migración
// 20261019000030_puntos_qr_f3_catalogo.sql y de las validaciones de
// `ronda_responder_paso()` de la 20261019000050: la base es la que manda y esto
// es para avisar antes de mandar la fila. Si cambia una, cambia la otra.
//
// La importación es RELATIVA y no por el alias del paquete por la misma razón
// que en lib/puntos-qr.ts: los scripts de prueba importan estos archivos por
// ruta y resuelven relativo, no el alias.
export * from '../../../../packages/ronda-core/src/pasos'
// Y lo que este archivo usa, importado del mismo sitio (un `export *` no
// mete los nombres en el alcance del módulo).
import {
  RESPUESTAS_CASILLA,
  type ConfigPaso, type OpcionSeleccion, type RespuestaCasilla, type TipoPaso,
} from '../../../../packages/ronda-core/src/pasos'

export type TipoInstructivo = 'FOTO' | 'VIDEO' | 'PDF' | 'AUDIO'
export type EstadoPlantilla = 'BORRADOR' | 'PUBLICADA' | 'ARCHIVADA'
export type EstadoInstructivo = 'BORRADOR' | 'PUBLICADO' | 'ARCHIVADO'
export type CategoriaActividad =
  | 'ASEO' | 'CONSERJERIA' | 'MANTENIMIENTO' | 'SEGURIDAD'
  | 'HSEQ' | 'ADMINISTRATIVA' | 'OTRA'

export type FrecuenciaAsignacion =
  | 'CADA_N_HORAS' | 'POR_TURNO' | 'DIARIA' | 'SEMANAL' | 'MENSUAL' | 'POR_EVENTO'
export type PrioridadAsignacion = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'

export const RESPUESTA_CASILLA_LABEL: Record<RespuestaCasilla, string> = {
  SI: 'Sí',
  NO: 'No',
  NO_APLICA: 'No aplica',
}

export interface MetaPaso {
  label: string
  /** Qué hace el paso, en una línea, para la ayuda del editor. */
  ayuda: string
  icono: string
  /** `config` con la que nace un paso de este tipo en el editor. */
  porDefecto: ConfigPaso
}

export const PASO_META: Record<TipoPaso, MetaPaso> = {
  CASILLA: {
    label: 'Casilla de verificación',
    ayuda: 'Sí / No / No aplica. Si se responde No, se puede exigir el motivo.',
    icono: 'ListChecks',
    porDefecto: { motivo_obligatorio_si_no: true },
  },
  FOTO: {
    label: 'Foto',
    ayuda: 'Una o varias fotos, con la opción de exigir cámara en vivo y que el QR salga en el encuadre.',
    icono: 'Camera',
    porDefecto: { min: 1, max: 3, solo_camara_vivo: true, exige_qr_en_encuadre: false },
  },
  VIDEO: {
    label: 'Video corto',
    ayuda: 'Un video con duración máxima.',
    icono: 'Video',
    porDefecto: { segundos_max: 15 },
  },
  TEXTO: {
    label: 'Texto libre',
    ayuda: 'Una nota escrita, con largo mínimo y máximo.',
    icono: 'Type',
    porDefecto: { min_caracteres: 0, max_caracteres: 500 },
  },
  NOTA_VOZ: {
    label: 'Nota de voz',
    ayuda: 'Un audio corto, que se puede transcribir.',
    icono: 'Mic',
    porDefecto: { segundos_max: 60, transcribir: true },
  },
  NUMERO: {
    label: 'Número',
    ayuda: 'Un valor numérico con rango, decimales y unidad (una lectura de medidor, por ejemplo).',
    icono: 'Hash',
    porDefecto: { min: 0, max: 9999, decimales: 0, unidad: '' },
  },
  SELECCION: {
    label: 'Selección',
    ayuda: 'Una o varias opciones de una lista.',
    icono: 'List',
    porDefecto: { multiple: false, opciones: [{ valor: 'A', etiqueta: 'Opción A' }] },
  },
  ESCANEO: {
    label: 'Escaneo de código',
    ayuda: 'Se escanea el código de un insumo o de un equipo y se resuelve contra el inventario.',
    icono: 'ScanLine',
    porDefecto: { entidad: 'producto', exige_existente: true },
  },
  FIRMA: {
    label: 'Firma',
    ayuda: 'Firma del trabajador o del cliente en la pantalla.',
    icono: 'PenLine',
    porDefecto: { quien: 'trabajador', permite_facial: false },
  },
}

export const TIPOS_PASO = Object.keys(PASO_META) as TipoPaso[]

export const CATEGORIA_ACTIVIDAD_LABEL: Record<CategoriaActividad, string> = {
  ASEO: 'Aseo',
  CONSERJERIA: 'Conserjería',
  MANTENIMIENTO: 'Mantenimiento',
  SEGURIDAD: 'Seguridad',
  HSEQ: 'Seguridad y salud (HSEQ)',
  ADMINISTRATIVA: 'Administrativa',
  OTRA: 'Otra',
}
export const CATEGORIAS_ACTIVIDAD = Object.keys(CATEGORIA_ACTIVIDAD_LABEL) as CategoriaActividad[]

export const FRECUENCIA_LABEL: Record<FrecuenciaAsignacion, string> = {
  CADA_N_HORAS: 'Cada N horas',
  POR_TURNO: 'Una vez por turno',
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
  POR_EVENTO: 'Cuando pasa algo (por evento)',
}
export const FRECUENCIAS = Object.keys(FRECUENCIA_LABEL) as FrecuenciaAsignacion[]

export const PRIORIDAD_META: Record<PrioridadAsignacion, { label: string; badge: string }> = {
  BAJA:    { label: 'Baja',    badge: 'bg-gray-100 text-gray-600' },
  MEDIA:   { label: 'Media',   badge: 'bg-sky-100 text-sky-700' },
  ALTA:    { label: 'Alta',    badge: 'bg-amber-100 text-amber-700' },
  CRITICA: { label: 'Crítica', badge: 'bg-red-100 text-red-700' },
}
export const PRIORIDADES = Object.keys(PRIORIDAD_META) as PrioridadAsignacion[]

export const ESTADO_PLANTILLA_META: Record<EstadoPlantilla, { label: string; badge: string }> = {
  BORRADOR:  { label: 'Borrador',  badge: 'bg-amber-100 text-amber-700' },
  PUBLICADA: { label: 'Publicada', badge: 'bg-emerald-100 text-emerald-700' },
  ARCHIVADA: { label: 'Archivada', badge: 'bg-gray-200 text-gray-600' },
}

export const TIPO_INSTRUCTIVO_LABEL: Record<TipoInstructivo, string> = {
  FOTO: 'Foto', VIDEO: 'Video', PDF: 'PDF', AUDIO: 'Audio',
}
export const TIPOS_INSTRUCTIVO = Object.keys(TIPO_INSTRUCTIVO_LABEL) as TipoInstructivo[]

/** 1 = lunes … 7 = domingo, igual que `puestos.dias_cobertura`. */
export const DIAS_SEMANA: { valor: number; corto: string; label: string }[] = [
  { valor: 1, corto: 'L',  label: 'Lunes' },
  { valor: 2, corto: 'M',  label: 'Martes' },
  { valor: 3, corto: 'Mi', label: 'Miércoles' },
  { valor: 4, corto: 'J',  label: 'Jueves' },
  { valor: 5, corto: 'V',  label: 'Viernes' },
  { valor: 6, corto: 'S',  label: 'Sábado' },
  { valor: 7, corto: 'D',  label: 'Domingo' },
]

/** Texto corto de los días: «Todos los días», «L a V» o la lista. */
export function textoDias(dias: number[]): string {
  const d = [...new Set(dias)].sort((a, b) => a - b)
  if (d.length === 7) return 'Todos los días'
  if (d.join() === '1,2,3,4,5') return 'L a V'
  if (d.join() === '1,2,3,4,5,6') return 'L a S'
  return d.map((n) => DIAS_SEMANA.find((x) => x.valor === n)?.corto ?? n).join(' ')
}

/** Texto de la ventana horaria, con el aviso de que cruza medianoche. */
export function textoVentana(desde: string | null, hasta: string | null): string {
  if (!desde || !hasta) return 'Todo el día'
  const corta = (t: string) => t.slice(0, 5)
  const cruza = hasta <= desde
  return `${corta(desde)} a ${corta(hasta)}${cruza ? ' (del día siguiente)' : ''}`
}

/** Resumen de la `config` para el listado de pasos del editor. */
export function resumenConfig(tipo: TipoPaso, config: ConfigPaso): string {
  switch (tipo) {
    case 'CASILLA':
      return config.motivo_obligatorio_si_no === false
        ? 'Sí / No / No aplica' : 'Sí / No / No aplica · un No exige motivo'
    case 'FOTO': {
      const partes = [`${config.min ?? 1} a ${config.max ?? 1} fotos`]
      if (config.solo_camara_vivo) partes.push('cámara en vivo')
      if (config.exige_qr_en_encuadre) partes.push('el QR en el encuadre')
      return partes.join(' · ')
    }
    case 'VIDEO':
      return `hasta ${config.segundos_max ?? 15} s`
    case 'TEXTO':
      return `${config.min_caracteres ?? 0} a ${config.max_caracteres ?? 500} caracteres`
    case 'NOTA_VOZ':
      return `hasta ${config.segundos_max ?? 60} s${config.transcribir ? ' · se transcribe' : ''}`
    case 'NUMERO':
      return `${config.min ?? 0} a ${config.max ?? 0}${config.unidad ? ' ' + config.unidad : ''}`
        + (config.decimales ? ` · ${config.decimales} decimales` : '')
    case 'SELECCION':
      return `${(config.opciones ?? []).length} opciones${config.multiple ? ' · varias' : ' · una'}`
    case 'ESCANEO':
      return config.entidad === 'maquinaria' ? 'código de equipo' : 'código de insumo'
    case 'FIRMA':
      return config.quien === 'cliente' ? 'firma el cliente' : 'firma el trabajador'
    default:
      return ''
  }
}

/**
 * ¿Un paso condicional puede depender de otro? Mismas reglas que la base: tiene
 * que ser de la misma plantilla, no él mismo, y —esto lo exige `publicar`— de
 * orden menor. Se aplica aquí para que el desplegable del editor solo ofrezca
 * los pasos válidos.
 */
export function pasosCondicionables<T extends { id: string; orden: number }>(
  pasos: T[],
  paso: { id?: string; orden: number },
): T[] {
  return pasos
    .filter((p) => p.id !== paso.id && p.orden < paso.orden)
    .sort((a, b) => a.orden - b.orden)
}

/** Valores que puede tomar la condición, según el tipo del paso del que depende. */
export function valoresCondicion(tipo: TipoPaso, config: ConfigPaso): OpcionSeleccion[] {
  if (tipo === 'CASILLA') {
    return RESPUESTAS_CASILLA.map((v) => ({ valor: v, etiqueta: RESPUESTA_CASILLA_LABEL[v] }))
  }
  if (tipo === 'SELECCION') return config.opciones ?? []
  return []
}

/** Solo las casillas y las selecciones tienen una respuesta discreta de la que condicionar. */
export function puedeCondicionar(tipo: TipoPaso): boolean {
  return tipo === 'CASILLA' || tipo === 'SELECCION'
}
