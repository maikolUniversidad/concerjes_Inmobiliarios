// Contrato de los pasos de una plantilla de tarea (F3 del módulo de Puntos QR).
//
// Es el espejo en TypeScript de `ronda_paso_config_valida()` de la migración
// 20261019000030_puntos_qr_f3_catalogo.sql, que es un CHECK de la tabla
// `ronda_plantilla_pasos`. Se duplica a propósito, como ya se hizo en
// lib/contratos-conserjeria.ts con `grupo_vigente()`: la base es la que manda
// —la respetan la PWA, el bot y la cola offline—, y esto es para que la consola
// avise antes de mandar la fila y no después, con un error de constraint.
// Si cambia una, cambia la otra.
//
// Lógica pura, sin Supabase ni React: así es testeable (ADR-E).
//
// NO hay un tipo de paso para el reto aleatorio del complemento 1, que no ha
// llegado. La §7 de docs/puntos-qr-whatsapp/02-complemento-2-integracion.md
// explica por qué no se nombra: fijar ahora el formato obligaría a adivinar.

export type TipoPaso =
  | 'CASILLA' | 'FOTO' | 'VIDEO' | 'TEXTO' | 'NOTA_VOZ'
  | 'NUMERO' | 'SELECCION' | 'ESCANEO' | 'FIRMA'

export type MomentoInstructivo = 'ANTES' | 'DURANTE'
export type TipoInstructivo = 'FOTO' | 'VIDEO' | 'PDF' | 'AUDIO'
export type EstadoPlantilla = 'BORRADOR' | 'PUBLICADA' | 'ARCHIVADA'
export type EstadoInstructivo = 'BORRADOR' | 'PUBLICADO' | 'ARCHIVADO'
export type CategoriaActividad =
  | 'ASEO' | 'CONSERJERIA' | 'MANTENIMIENTO' | 'SEGURIDAD'
  | 'HSEQ' | 'ADMINISTRATIVA' | 'OTRA'

export type FrecuenciaAsignacion =
  | 'CADA_N_HORAS' | 'POR_TURNO' | 'DIARIA' | 'SEMANAL' | 'MENSUAL' | 'POR_EVENTO'
export type PrioridadAsignacion = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'

/** Las tres respuestas de una casilla. Un NO puede exigir motivo. */
export const RESPUESTAS_CASILLA = ['SI', 'NO', 'NO_APLICA'] as const
export type RespuestaCasilla = (typeof RESPUESTAS_CASILLA)[number]

export const RESPUESTA_CASILLA_LABEL: Record<RespuestaCasilla, string> = {
  SI: 'Sí',
  NO: 'No',
  NO_APLICA: 'No aplica',
}

export interface OpcionSeleccion { valor: string; etiqueta: string }

/** `config` de un paso. Todas las claves son opcionales salvo donde se diga. */
export interface ConfigPaso {
  // CASILLA
  motivo_obligatorio_si_no?: boolean
  // FOTO
  min?: number
  max?: number
  solo_camara_vivo?: boolean
  exige_qr_en_encuadre?: boolean
  // VIDEO y NOTA_VOZ
  segundos_max?: number
  transcribir?: boolean
  // TEXTO
  min_caracteres?: number
  max_caracteres?: number
  // NUMERO (min y max se comparten con FOTO)
  decimales?: number
  unidad?: string
  // SELECCION
  multiple?: boolean
  opciones?: OpcionSeleccion[]
  // ESCANEO (entidad obligatoria)
  entidad?: 'producto' | 'maquinaria'
  exige_existente?: boolean
  // FIRMA (quien obligatorio)
  quien?: 'trabajador' | 'cliente'
  permite_facial?: boolean
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

/**
 * Valida la `config` de un paso igual que el CHECK de la base. Devuelve el
 * primer problema en español, o `null` si está bien.
 */
export function validarConfigPaso(tipo: TipoPaso, config: ConfigPaso): string | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const presente = (k: keyof ConfigPaso) => config[k] !== undefined && config[k] !== null

  switch (tipo) {
    case 'CASILLA':
      return null

    case 'FOTO': {
      const min = num(config.min) ?? 1
      const max = num(config.max) ?? 1
      if (presente('min') && num(config.min) === undefined) return 'El mínimo de fotos tiene que ser un número.'
      if (presente('max') && num(config.max) === undefined) return 'El máximo de fotos tiene que ser un número.'
      if (min < 0 || min > 20) return 'El mínimo de fotos va de 0 a 20.'
      if (max < 1 || max > 20) return 'El máximo de fotos va de 1 a 20.'
      if (presente('min') && presente('max') && max < min) {
        return 'El máximo de fotos no puede ser menor que el mínimo.'
      }
      return null
    }

    case 'VIDEO': {
      const s = num(config.segundos_max) ?? 15
      if (s < 3 || s > 300) return 'La duración máxima del video va de 3 a 300 segundos.'
      return null
    }

    case 'TEXTO': {
      const min = num(config.min_caracteres) ?? 0
      const max = num(config.max_caracteres) ?? 500
      if (min < 0 || min > 4000) return 'El mínimo de caracteres va de 0 a 4.000.'
      if (max < 1 || max > 4000) return 'El máximo de caracteres va de 1 a 4.000.'
      if (presente('min_caracteres') && presente('max_caracteres') && max < min) {
        return 'El máximo de caracteres no puede ser menor que el mínimo.'
      }
      return null
    }

    case 'NOTA_VOZ': {
      const s = num(config.segundos_max) ?? 60
      if (s < 3 || s > 600) return 'La duración máxima de la nota de voz va de 3 a 600 segundos.'
      return null
    }

    case 'NUMERO': {
      const dec = num(config.decimales) ?? 0
      if (dec < 0 || dec > 4) return 'Los decimales van de 0 a 4.'
      if (presente('min') && presente('max') && (num(config.max) ?? 0) < (num(config.min) ?? 0)) {
        return 'El máximo no puede ser menor que el mínimo.'
      }
      return null
    }

    case 'SELECCION': {
      const ops = config.opciones
      if (!Array.isArray(ops) || ops.length === 0) return 'Hay que dar al menos una opción.'
      if (ops.some((o) => !o || typeof o.valor !== 'string' || typeof o.etiqueta !== 'string'
                          || o.valor.trim() === '' || o.etiqueta.trim() === '')) {
        return 'Cada opción necesita un valor y una etiqueta.'
      }
      if (new Set(ops.map((o) => o.valor)).size !== ops.length) {
        return 'Hay dos opciones con el mismo valor.'
      }
      return null
    }

    case 'ESCANEO':
      if (config.entidad !== 'producto' && config.entidad !== 'maquinaria') {
        return 'Hay que decir si se escanea un insumo o un equipo.'
      }
      return null

    case 'FIRMA':
      if (config.quien !== 'trabajador' && config.quien !== 'cliente') {
        return 'Hay que decir quién firma.'
      }
      return null

    default:
      return 'Tipo de paso desconocido.'
  }
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
