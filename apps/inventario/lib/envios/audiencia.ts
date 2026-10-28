// La audiencia de un envío masivo: lo que se valida ANTES de llamar a la base.
//
// QUIÉN RESUELVE DE VERDAD: `crm_envio_resolver()` en SQL, que recorre la
// nómina y escribe una fila por persona con su motivo de exclusión. Esto de acá
// no resuelve nada: normaliza y comprueba la FORMA de lo que se va a pedir, para
// que un envío mal armado se corrija en el formulario y no se guarde.
//
// LA REGLA QUE JUSTIFICA EL ALCANCE EXPLÍCITO: sin él, un envío que solo nombra
// tres personas sueltas no se distingue de un envío a todo el contrato con tres
// personas anotadas al margen. Con 6.000 personas en la nómina, esa confusión se
// paga en mensajes a celulares personales que nadie quería mandar.

export type AlcanceAudiencia = 'CONTRATO' | 'SEDES' | 'PERSONAS' | 'LISTA'
export type FiltroTurno = 'CUALQUIERA' | 'EN_TURNO' | 'FUERA_TURNO'

export const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AudienciaEntrada {
  alcance?: string | null
  sedes?: string[]
  cargos?: string[]
  turno?: string | null
  lista?: string | null
  personas?: string[]
}

export interface Audiencia {
  alcance: AlcanceAudiencia
  sedes: string[]
  /** Cargos de nómina, en mayúsculas y sin espacios de más: así se comparan con
   *  `personas.cargo`, que en esta base es texto libre. */
  cargos: string[]
  turno: FiltroTurno
  lista: string | null
  personas: string[]
}

const ALCANCES: AlcanceAudiencia[] = ['CONTRATO', 'SEDES', 'PERSONAS', 'LISTA']
const TURNOS: FiltroTurno[] = ['CUALQUIERA', 'EN_TURNO', 'FUERA_TURNO']

/** Normaliza un cargo igual que lo hace la base. */
export function normalizarCargo(cargo: string): string {
  return cargo.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Deja la audiencia en la forma que espera la RPC. No valida: normaliza. */
export function normalizarAudiencia(e: AudienciaEntrada): Audiencia {
  const alcance = (e.alcance ?? '').trim().toUpperCase() as AlcanceAudiencia
  const turno = (e.turno ?? '').trim().toUpperCase() as FiltroTurno
  return {
    alcance: ALCANCES.includes(alcance) ? alcance : 'CONTRATO',
    sedes: [...new Set((e.sedes ?? []).map((s) => s.trim()).filter((s) => ES_UUID.test(s)))],
    cargos: [...new Set((e.cargos ?? []).map(normalizarCargo).filter((c) => c !== ''))],
    turno: TURNOS.includes(turno) ? turno : 'CUALQUIERA',
    lista: (e.lista ?? '').trim() === '' ? null : (e.lista ?? '').trim(),
    personas: [...new Set((e.personas ?? []).map((p) => p.trim()).filter((p) => ES_UUID.test(p)))],
  }
}

/**
 * Qué le falta a la audiencia para poder pedirla. Devuelve `null` si está bien.
 *
 * Es la misma regla que el CHECK `ck_crm_envio_alcance` de la tabla, dicha en
 * español: un envío «a estas sedes» sin sedes es un envío a nadie que parece un
 * envío a todos, y esa confusión no se puede dejar pasar.
 */
export function faltaEnAudiencia(a: Audiencia): string | null {
  if (a.alcance === 'SEDES' && a.sedes.length === 0) {
    return 'Elegiste «sedes concretas» pero no marcaste ninguna sede.'
  }
  if (a.alcance === 'PERSONAS' && a.personas.length === 0) {
    return 'Elegiste «personas sueltas» pero no hay ninguna persona válida en la lista.'
  }
  if (a.alcance === 'LISTA' && !a.lista) {
    return 'Elegiste «una lista del directorio» pero no dijiste cuál.'
  }
  return null
}

/** Las líneas de un textarea, como lista de variables en orden. */
export function variablesDeTexto(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => v !== '')
}

/** Los marcadores que `crm_envio_render()` sabe resolver. Lista CERRADA. */
export const MARCADORES = [
  'nombre', 'sede', 'cargo', 'contrato', 'hora', 'fecha', 'punto', 'punto_nombre',
] as const

/** Marcadores escritos en un texto que la base no va a reemplazar. Sirve para
 *  avisar en el formulario en vez de mandar «Hola {nombe}» a 400 personas. */
export function marcadoresDesconocidos(texto: string | null | undefined): string[] {
  const usados = [...(texto ?? '').matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1].toLowerCase())
  return [...new Set(usados.filter((u) => !MARCADORES.includes(u as (typeof MARCADORES)[number])))]
}

/** Los motivos de exclusión, en español, para la pantalla. */
export const MOTIVO_EXCLUSION: Record<string, string> = {
  SIN_CANAL: 'sin WhatsApp verificado',
  SIN_CONSENTIMIENTO: 'no dio permiso de WhatsApp',
  CANAL_BLOQUEADO: 'su número está inhabilitado',
  PERSONA_INACTIVA: 'ya no está activa en la nómina',
  FUERA_DEL_CONTRATO: 'su sede es de otro contrato',
  SIN_SEDE: 'no tiene sede asignada',
}

export interface ResumenAudiencia {
  destinos: number
  excluidos: number
  exclusiones: { motivo: string; legible: string; n: number }[]
}

/** Ordena el desglose que devuelve `crm_envio_resolver()` para mostrarlo. */
export function leerResumen(resumen: Record<string, unknown> | null | undefined): ResumenAudiencia {
  const r = resumen ?? {}
  const crudas = (r.exclusiones ?? {}) as Record<string, number>
  return {
    destinos: Number(r.destinos ?? 0),
    excluidos: Number(r.excluidos ?? 0),
    exclusiones: Object.entries(crudas)
      .map(([motivo, n]) => ({
        motivo,
        legible: MOTIVO_EXCLUSION[motivo] ?? motivo.toLowerCase().replace(/_/g, ' '),
        n: Number(n),
      }))
      .sort((a, b) => b.n - a.n),
  }
}
