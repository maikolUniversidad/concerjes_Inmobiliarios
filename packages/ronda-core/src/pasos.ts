// Contrato de los pasos de una plantilla y validación de lo que se contesta.
//
// Es el espejo en TypeScript de dos cosas de la base:
//   · `ronda_paso_config_valida()` (CHECK de `ronda_plantilla_pasos`, F3) — qué
//     `config` es válida para cada tipo de paso;
//   · las validaciones de `ronda_responder_paso()` y los CHECK de
//     `ronda_respuestas` (F4) — qué respuesta es válida para cada paso.
//
// Vive en el paquete y no en la app por la decisión §1.1 del complemento 2: la
// PWA de `apps/inventario` (React 19) y el módulo de `apps/movil` (React 18)
// tienen que validar IGUAL, y cualquier cosa escrita como componente se duplica.
// Las etiquetas, iconos y colores de la consola siguen en
// `apps/inventario/lib/ronda/pasos.ts`, que reexporta esto: eso sí es de la app.
//
// La base es la que manda. Esto existe para avisar antes de mandar y para que la
// visita se pueda completar sin señal (ADR-02 §2.9, punto 4: «reglas de
// completitud de la plantilla … funciona sin IA y sin red»).
//
// NO hay un tipo de paso para el reto aleatorio del complemento 1, que no ha
// llegado (§7 del complemento 2).

export type TipoPaso =
  | 'CASILLA' | 'FOTO' | 'VIDEO' | 'TEXTO' | 'NOTA_VOZ'
  | 'NUMERO' | 'SELECCION' | 'ESCANEO' | 'FIRMA'

export type MomentoInstructivo = 'ANTES' | 'DURANTE'

/** Las tres respuestas de una casilla. Un NO puede exigir motivo. */
export const RESPUESTAS_CASILLA = ['SI', 'NO', 'NO_APLICA'] as const
export type RespuestaCasilla = (typeof RESPUESTAS_CASILLA)[number]

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

/** Un paso tal como lo guarda `ronda_plantilla_pasos`. */
export interface Paso {
  id: string
  orden: number
  tipo: TipoPaso
  titulo: string
  ayuda?: string | null
  obligatorio: boolean
  config: ConfigPaso
  instructivo_id?: string | null
  instructivo_momento?: MomentoInstructivo | null
  condicion_paso_id?: string | null
  condicion_valor?: string | null
}

/** Lo que se contesta de un paso, en el formato que viaja a la RPC. */
export interface ValorRespuesta {
  casilla?: RespuestaCasilla
  texto?: string
  numero?: number
  opciones?: string[]
  transcripcion?: string
  entidad_tipo?: 'producto' | 'maquinaria'
  entidad_id?: string
  entidad_codigo?: string
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

/** ¿Un «No» de esta casilla exige motivo? Es lo que la base deriva a
 *  `ronda_respuestas.motivo_exigido`; por defecto SÍ. */
export function exigeMotivoSiNo(config: ConfigPaso): boolean {
  return config.motivo_obligatorio_si_no !== false
}

/** Mínimo y máximo de fotos de un paso FOTO. */
export function rangoFotos(config: ConfigPaso): { min: number; max: number } {
  return { min: config.min ?? 1, max: config.max ?? Math.max(config.min ?? 1, 1) }
}

/**
 * Valida la RESPUESTA de un paso con las mismas reglas que
 * `ronda_responder_paso()`. Devuelve el primer problema en español, o `null`.
 *
 * `fotos` es cuántas fotos lleva adjuntas el paso, que la pantalla sabe antes
 * de mandar nada. `omitido` salta las validaciones de valor pero exige motivo:
 * un paso que se salta sin explicación es lo mismo que no hacer la tarea.
 */
export function validarRespuesta(
  paso: Paso,
  valor: ValorRespuesta,
  opciones: { motivo?: string | null; omitido?: boolean; omisionMotivo?: string | null; fotos?: number } = {},
): string | null {
  const { motivo, omitido, omisionMotivo, fotos = 0 } = opciones
  const vacio = (s?: string | null) => !s || s.trim() === ''

  if (omitido) {
    return vacio(omisionMotivo) ? 'Para saltar este paso hay que decir por qué.' : null
  }

  switch (paso.tipo) {
    case 'CASILLA': {
      const c = valor.casilla
      if (!c || !RESPUESTAS_CASILLA.includes(c)) return 'Contesta Sí, No o No aplica.'
      if (c === 'NO' && exigeMotivoSiNo(paso.config) && vacio(motivo)) {
        return 'Al responder No hay que escribir el motivo.'
      }
      return null
    }
    case 'FOTO': {
      const { min } = rangoFotos(paso.config)
      if (fotos < min) {
        return min === 1 ? 'Falta la foto.' : `Faltan fotos: se piden ${min} y hay ${fotos}.`
      }
      return null
    }
    case 'TEXTO': {
      const t = valor.texto ?? ''
      const min = paso.config.min_caracteres ?? 0
      const max = paso.config.max_caracteres ?? 500
      if (t.trim().length < min) return `Escribe al menos ${min} caracteres.`
      if (t.length > max) return `El texto no puede pasar de ${max} caracteres.`
      if (paso.obligatorio && vacio(t)) return 'Falta escribir la respuesta.'
      return null
    }
    case 'NUMERO': {
      const n = valor.numero
      if (n === undefined || n === null || Number.isNaN(n)) return 'Falta el número.'
      if (paso.config.min !== undefined && n < paso.config.min) {
        return `El valor no puede ser menor que ${paso.config.min}.`
      }
      if (paso.config.max !== undefined && n > paso.config.max) {
        return `El valor no puede ser mayor que ${paso.config.max}.`
      }
      return null
    }
    case 'SELECCION': {
      const ops = valor.opciones ?? []
      if (ops.length === 0) return 'Escoge una opción.'
      if (!paso.config.multiple && ops.length > 1) return 'Aquí se escoge una sola opción.'
      const validas = new Set((paso.config.opciones ?? []).map((o) => o.valor))
      if (ops.some((o) => !validas.has(o))) return 'Una de las opciones no es de la lista.'
      return null
    }
    case 'ESCANEO':
      if (vacio(valor.entidad_codigo) && vacio(valor.texto)) return 'Falta escanear el código.'
      return null
    case 'NOTA_VOZ':
    case 'VIDEO':
      // El medio se valida al adjuntarlo (ver `validarEvidencia`).
      return null
    case 'FIRMA':
      // La firma no es una respuesta: es una fila de `ronda_firmas`.
      return null
    default:
      return 'Tipo de paso desconocido.'
  }
}

/**
 * ¿Este paso se muestra? Un paso condicional solo aplica si el paso del que
 * depende quedó contestado con el valor de la condición. Es la misma
 * comprobación que hace `ronda_validar_cierre()` en la base: si las dos no
 * coinciden, la pantalla pediría cosas que el servidor no exige, o al
 * contrario.
 */
export function pasoAplica(
  paso: Paso,
  respuestas: Record<string, { casilla?: string | null; opciones?: string[] | null }>,
): boolean {
  if (!paso.condicion_paso_id || !paso.condicion_valor) return true
  const r = respuestas[paso.condicion_paso_id]
  if (!r) return false
  if (r.casilla && r.casilla === paso.condicion_valor) return true
  return (r.opciones ?? []).includes(paso.condicion_valor)
}

/** Origen de un archivo de evidencia, tal como lo guarda la base. */
export type OrigenEvidencia = 'CAMARA_VIVO' | 'GALERIA' | 'WHATSAPP' | 'CONSOLA'

export interface EvidenciaLocal {
  id: string
  pasoId: string
  tipo: 'FOTO' | 'VIDEO' | 'AUDIO'
  origen: OrigenEvidencia
  sha256: string
  hashPerceptual?: string | null
  mime?: string | null
  tamano?: number | null
  ancho?: number | null
  alto?: number | null
  duracionSeg?: number | null
  lat?: number | null
  lng?: number | null
  precisionMetros?: number | null
  capturadoDispositivo?: string | null
  qrDetectado?: string | null
  /** Ruta en el bucket `rondas`, cuando ya subió. */
  rutaArchivo?: string | null
}

/**
 * Valida un archivo antes de adjuntarlo, con las mismas reglas que el trigger
 * `ronda_evidencias_validar()`. Lo importante: si el paso exige cámara en vivo,
 * un archivo de la galería NO se acepta — y aquí se dice con un mensaje que se
 * entiende, en vez de dejar que reviente el servidor después de subir 3 MB por
 * una red de sótano.
 */
export function validarEvidencia(paso: Paso, ev: EvidenciaLocal): string | null {
  if (paso.tipo === 'FOTO' && paso.config.solo_camara_vivo && ev.origen !== 'CAMARA_VIVO') {
    return 'Este paso exige la foto tomada con la cámara en el momento: no se puede usar una de la galería.'
  }
  if (!/^[0-9a-f]{64}$/.test(ev.sha256 ?? '')) {
    return 'El archivo llegó sin su huella (sha256): vuelve a tomarlo.'
  }
  if (paso.tipo === 'FOTO' && ev.tipo !== 'FOTO') return 'Este paso espera una foto.'
  if (paso.tipo === 'VIDEO' && ev.tipo !== 'VIDEO') return 'Este paso espera un video.'
  if (paso.tipo === 'NOTA_VOZ' && ev.tipo !== 'AUDIO') return 'Este paso espera una nota de voz.'
  const max = paso.config.segundos_max
  if (max && ev.duracionSeg && ev.duracionSeg > max + 1) {
    return `La grabación no puede pasar de ${max} segundos.`
  }
  return null
}

/** ¿El paso pide que el QR salga en el encuadre de la foto? */
export function exigeQrEnEncuadre(paso: Paso): boolean {
  return paso.tipo === 'FOTO' && paso.config.exige_qr_en_encuadre === true
}
