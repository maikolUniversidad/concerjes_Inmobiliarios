// Comandos del bot. Se reconocen sin importar mayúsculas, tildes ni signos, y
// también en su forma más natural («ayuda», «¿me ayudás?»). Funcionan SIEMPRE,
// en cualquier estado: es lo que evita que alguien quede atrapado en un paso.
//
// POR QUÉ UNA LISTA CERRADA Y NO UN MODELO: lo que llega por el webhook es dato
// hostil. Un comando se reconoce comparando contra estas tablas, nunca
// interpretando. El clasificador de intención por IA (§6 del ADR-01) es un paso
// POSTERIOR y solo para lo que no calza: devuelve un intento, y el motor
// decide. El modelo no ejecuta nada, no cierra una visita, no confirma un
// resumen y no crea un QR.

export type Comando =
  | 'AYUDA'
  // F10: el menú configurable por contrato y rol (§4.2 del complemento 2) y la
  // próxima parada de la ruta (§4.3). Van APARTE de AYUDA: la ayuda es un texto
  // fijo que explica qué se puede hacer, y el menú es una lista de opciones que
  // cada contrato configura y que se puede tocar.
  | 'MENU'
  | 'PROXIMA_UBICACION'
  | 'MIS_PUNTOS'
  | 'SIGUIENTE'
  | 'NOVEDAD'
  | 'CANCELAR'
  | 'CREAR_QR'
  | 'SUPERVISOR'
  | 'PRIVACIDAD'

/** Quita tildes, signos y espacios de más. Lo que queda es comparable. */
export function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    // Marcas diacríticas: ̀–ͯ. La ñ se preserva recomponiendo abajo.
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9ÑÜ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Frases exactas y sus variantes naturales. El orden importa: se prueba de la
 *  más específica a la más general, para que «mis puntos» no caiga en «puntos»
 *  ni «hablar con supervisor» en «ayuda». */
const FRASES: { comando: Comando; frases: string[] }[] = [
  {
    comando: 'CREAR_QR',
    frases: ['CREAR QR', 'NUEVO QR', 'CREAR PUNTO', 'NUEVO PUNTO', 'GENERAR QR'],
  },
  {
    comando: 'SUPERVISOR',
    frases: [
      'HABLAR CON SUPERVISOR',
      'SUPERVISOR',
      'HABLAR CON UNA PERSONA',
      'HABLAR CON ALGUIEN',
      'QUIERO HABLAR CON MI SUPERVISOR',
      'NECESITO UN SUPERVISOR',
      'AGENTE',
    ],
  },
  {
    // Antes que MIS_PUNTOS y que SIGUIENTE: «mi próximo punto» no es «mis
    // puntos», y «siguiente ubicación» no es «ya terminé este punto».
    comando: 'PROXIMA_UBICACION',
    frases: [
      'MI PROXIMO PUNTO',
      'PROXIMO PUNTO',
      'PROXIMA UBICACION',
      'SIGUIENTE UBICACION',
      'A DONDE SIGO',
      'A DONDE VOY',
      'DONDE SIGO',
      'CUAL ES MI PROXIMO PUNTO',
      'MI SIGUIENTE PUNTO',
      'PROXIMA PARADA',
    ],
  },
  {
    comando: 'MENU',
    frases: ['MENU', 'OPCIONES', 'VER OPCIONES', 'VER EL MENU', 'QUE PUEDO HACER'],
  },
  {
    comando: 'MIS_PUNTOS',
    frases: [
      'MIS PUNTOS',
      'MIS RONDAS',
      'VER MIS PUNTOS',
      'QUE PUNTOS TENGO',
      'CUALES SON MIS PUNTOS',
      'PUNTOS DE HOY',
      'MI RONDA',
      'MI RONDA DE HOY',
    ],
  },
  {
    comando: 'PRIVACIDAD',
    frases: [
      'PRIVACIDAD',
      'MIS PERMISOS',
      'MIS DATOS',
      'PERMISOS',
      'RETIRAR PERMISO',
      'BORRAR MIS DATOS',
      'CONSENTIMIENTOS',
    ],
  },
  {
    comando: 'NOVEDAD',
    frases: ['NOVEDAD', 'REPORTAR NOVEDAD', 'REPORTAR UN PROBLEMA', 'HAY UN PROBLEMA', 'REPORTAR'],
  },
  {
    comando: 'CANCELAR',
    frases: ['CANCELAR', 'CANCELA', 'ANULAR', 'DEJAR ESTO', 'OLVIDALO', 'SALIR'],
  },
  {
    comando: 'SIGUIENTE',
    frases: [
      'SIGUIENTE',
      'TERMINAR PUNTO',
      'TERMINE',
      'YA TERMINE',
      'SIGUIENTE PUNTO',
      'PASAR AL SIGUIENTE',
      'LISTO EL PUNTO',
    ],
  },
  {
    comando: 'AYUDA',
    frases: [
      'AYUDA',
      'AYUDAME',
      'ME AYUDAS',
      'ME AYUDA',
      'SOCORRO',
      'NO ENTIENDO',
      'QUE HAGO',
      'COMO FUNCIONA',
      'HELP',
    ],
  },
]

/** ¿El texto es un comando? Devuelve el comando o `null`. */
export function reconocer(texto: string | null | undefined): Comando | null {
  const t = normalizar(texto)
  if (!t) return null
  for (const { comando, frases } of FRASES) {
    for (const f of frases) {
      // Exacto, o la frase al principio del mensaje («ayuda, no me sale esto»).
      if (t === f || t.startsWith(f + ' ')) return comando
    }
  }
  return null
}

/** Un saludo suelto. En `SIN_VISITA` con identidad verificada se responde con
 *  la lista de puntos del día, que es lo útil. */
export function esSaludo(texto: string | null | undefined): boolean {
  const t = normalizar(texto)
  if (!t) return false
  return [
    'HOLA',
    'BUENAS',
    'BUENOS DIAS',
    'BUENAS TARDES',
    'BUENAS NOCHES',
    'QUE MAS',
    'HEY',
    'ALO',
    'SALUDOS',
    'HOLA BUENAS',
  ].some((s) => t === s || t.startsWith(s + ' '))
}

/** Un «sí» y un «no» escritos a mano, para cuando alguien contesta con texto en
 *  vez de tocar el botón. Nunca decide algo irreversible por su cuenta: la
 *  máquina solo lo usa donde el botón equivalente sería inofensivo. */
export function siONo(texto: string | null | undefined): boolean | null {
  const t = normalizar(texto)
  if (!t) return null
  if (['SI', 'SII', 'CLARO', 'DALE', 'OK', 'OKEY', 'LISTO', 'CORRECTO', 'ASI ES', 'AFIRMATIVO'].includes(t)) return true
  if (['NO', 'NOO', 'NEGATIVO', 'NUNCA', 'NO ES', 'INCORRECTO', 'MAL'].includes(t)) return false
  return null
}

/**
 * Normaliza un código de punto escrito a mano.
 *
 * Acepta `PUNTO K7M-4QX9`, `punto k7m4qx9`, `K7M-4QX9` y `k7m4qx9`: se quita el
 * prefijo, se quita todo lo que no sea letra o número, y queda la forma
 * canónica. NO se valida que exista: eso lo hace la base, comparando contra
 * `ronda_puntos.codigo`. Aquí solo se limpia lo que alguien tecleó con una mano
 * mientras sostiene una linterna con la otra.
 */
export function codigoDePunto(texto: string | null | undefined): string | null {
  const t = normalizar(texto)
  if (!t) return null
  const sinPrefijo = t.replace(/^(PUNTO|CODIGO|QR|EL PUNTO|PUNTO NUMERO)\s+/, '')
  const limpio = sinPrefijo.replace(/[^A-Z0-9]/g, '')
  // Un código de punto es corto. Un mensaje largo no es un código, es una frase.
  if (limpio.length < 4 || limpio.length > 24) return null
  // Tiene que traer al menos un dígito y al menos una letra: así «BUENASTARDES»
  // no se confunde con un código.
  if (!/[0-9]/.test(limpio) || !/[A-Z]/.test(limpio)) return null
  return limpio
}

/** Un documento de identidad teclado: solo números, de 5 a 15 dígitos. */
export function documento(texto: string | null | undefined): string | null {
  const t = (texto ?? '').replace(/[^0-9]/g, '')
  return t.length >= 5 && t.length <= 15 ? t : null
}

/**
 * ¿Parece una medición? Devuelve número y unidad, o `null`.
 *
 * «presión 12 bar» → 12 bar · «nivel 80%» → 80 % · «3 extintores» → 3 extintores
 *
 * Nunca se da por buena sola: la máquina confirma con botones antes de
 * guardarla. Un número mal leído en un reporte es un número que alguien va a
 * discutir con su supervisor.
 */
export function medicion(texto: string | null | undefined): { valor: number; unidad: string | null } | null {
  const t = (texto ?? '').trim()
  if (!t || t.length > 120) return null
  // Coma o punto decimal: en Colombia se escribe «12,5».
  const m = t.match(/(-?\d{1,9}(?:[.,]\d{1,3})?)\s*([%A-Za-zÁÉÍÓÚáéíóúÑñ°/]{0,16})/)
  if (!m) return null
  const valor = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(valor)) return null
  const unidad = (m[2] ?? '').trim()
  return { valor, unidad: unidad === '' ? null : unidad }
}
