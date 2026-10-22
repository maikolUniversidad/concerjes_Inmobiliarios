// Cola de MEDIOS: lo que el ADR-D le pide a este paquete además del outbox.
//
// El outbox de `outbox.ts` manda intents (JSON). Una visita de ronda trae
// además archivos: diez fotos, un video corto, una nota de voz. Esos no caben
// en un intent y tienen que subir ANTES que el intent que los referencia, o el
// servidor recibiría una evidencia que apunta a un archivo que no existe.
//
// Decisiones, y por qué:
//   · los blobs viven en el store local (IndexedDB en la PWA) con su `sha256`
//     ya calculado: así el reintento no vuelve a leer ni a hashear el archivo;
//   · reintento con espera creciente (backoff). Una red de sótano que va y
//     viene no debe convertirse en cien intentos por minuto gastando batería;
//   · la cola se puede MIRAR y se puede DESCARTAR con motivo. Es lo que el
//     ADR-D exige: puede haber visitas pendientes días, y una foto que nunca
//     va a subir (el archivo se corrompió) no puede dejar una visita colgada
//     para siempre sin que nadie entienda por qué;
//   · el orden importa: `subirMedios()` sube todo lo de una visita antes de que
//     `pushOutboxPorGrupo()` mande sus intents.
//
// Framework-agnóstico como el resto del paquete: quién sube de verdad lo decide
// la app (subida directa al bucket con las políticas del ADR-C, o un route
// handler con la llave de servicio cuando quien trabaja entró con enlace + PIN
// y no tiene sesión de Supabase).

export interface MedioPendiente {
  /** El id de la evidencia, que lo genera el dispositivo: es la llave de
   *  idempotencia de `ronda_adjuntar_evidencia`. */
  id: string
  /** Para qué visita es, y es por lo que se agrupa la cola. */
  grupo: string
  /** Ruta destino en el bucket. La arma `rutaEvidencia…` de ronda-core. */
  ruta: string
  mime: string
  sha256: string
  tamano: number
  /** El archivo. En IndexedDB se guarda tal cual (Blob); en memoria, lo que
   *  sea que el llamador quiera guardar. */
  blob: unknown
  creadoEn: string
  intentos: number
  /** Cuándo se puede volver a intentar (backoff). */
  reintentarDespuesDe?: string | null
  ultimoError?: string | null
  /** Descartado a mano, con motivo. No se borra: queda para poder explicarlo. */
  descartadoEn?: string | null
  descarteMotivo?: string | null
}

/** Almacenamiento de la cola de medios. Va APARTE de `StorageAdapter` a
 *  propósito: así las implementaciones que ya existen (la de `apps/movil`) no
 *  se rompen por tener que crecer. */
export interface MedioStore {
  addMedio(m: MedioPendiente): Promise<void>
  getMedios(grupo?: string): Promise<MedioPendiente[]>
  putMedio(m: MedioPendiente): Promise<void>
  removeMedio(id: string): Promise<void>
}

/** Quién sube de verdad. Devuelve la ruta final (normalmente la misma). */
export type SubidorMedio = (m: MedioPendiente) => Promise<string>

export interface OpcionesSubida {
  /** Intentos antes de dejar el medio quieto esperando una mano. 6 por defecto. */
  maxIntentos?: number
  /** Espera base del backoff en ms. 2.000 por defecto → 2 s, 4, 8, 16, 32, 64. */
  esperaBaseMs?: number
  /** Para probar sin reloj de verdad. */
  ahora?: () => Date
}

export interface ResultadoSubida {
  subidos: number
  pendientes: number
  /** Los que ya agotaron los intentos: hay que mirarlos. */
  atascados: string[]
  errores: string[]
}

/** Cuánto esperar antes del intento número `n` (1 = el primer reintento). */
export function esperaBackoffMs(intentos: number, baseMs = 2000): number {
  return baseMs * Math.pow(2, Math.max(0, intentos - 1))
}

/**
 * Sube lo que esté pendiente, en orden de creación. Si `grupo` viene, solo los
 * de esa visita: es lo que hace la PWA antes de mandar los intents de una
 * visita, para que la evidencia exista cuando el servidor la registre.
 */
export async function subirMedios(
  store: MedioStore,
  subir: SubidorMedio,
  grupo?: string,
  opciones: OpcionesSubida = {},
): Promise<ResultadoSubida> {
  const maxIntentos = opciones.maxIntentos ?? 6
  const baseMs = opciones.esperaBaseMs ?? 2000
  const ahora = (opciones.ahora ?? (() => new Date()))()

  const todos = (await store.getMedios(grupo))
    .filter((m) => !m.descartadoEn)
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn))

  const res: ResultadoSubida = { subidos: 0, pendientes: 0, atascados: [], errores: [] }

  for (const m of todos) {
    if (m.intentos >= maxIntentos) { res.atascados.push(m.id); continue }
    if (m.reintentarDespuesDe && new Date(m.reintentarDespuesDe) > ahora) {
      res.pendientes++
      continue
    }
    try {
      await subir(m)
      await store.removeMedio(m.id)
      res.subidos++
    } catch (e) {
      const intentos = m.intentos + 1
      const mensaje = e instanceof Error ? e.message : 'error al subir'
      await store.putMedio({
        ...m,
        intentos,
        ultimoError: mensaje,
        reintentarDespuesDe: new Date(
          ahora.getTime() + esperaBackoffMs(intentos, baseMs)).toISOString(),
      })
      res.errores.push(`${m.ruta}: ${mensaje}`)
      if (intentos >= maxIntentos) res.atascados.push(m.id)
      else res.pendientes++
    }
  }
  return res
}

/** Descartar un medio que no va a subir nunca. Con motivo, y sin borrarlo de la
 *  lista: una foto que desaparece sin explicación deja a la visita incompleta y
 *  a nadie con la respuesta. */
export async function descartarMedio(
  store: MedioStore, id: string, motivo: string, ahora: Date = new Date(),
): Promise<boolean> {
  const m = (await store.getMedios()).find((x) => x.id === id)
  if (!m) return false
  await store.putMedio({
    ...m, descartadoEn: ahora.toISOString(), descarteMotivo: motivo.trim() || 'Sin motivo',
  })
  return true
}

/** Lo que la pantalla de la cola necesita mostrar, por visita. */
export async function resumenMedios(
  store: MedioStore,
): Promise<Record<string, { pendientes: number; bytes: number; atascados: number }>> {
  const out: Record<string, { pendientes: number; bytes: number; atascados: number }> = {}
  for (const m of await store.getMedios()) {
    if (m.descartadoEn) continue
    const g = (out[m.grupo] ??= { pendientes: 0, bytes: 0, atascados: 0 })
    g.pendientes++
    g.bytes += m.tamano ?? 0
    if (m.intentos >= 6) g.atascados++
  }
  return out
}

/** Implementación en memoria (pruebas y SSR). */
export class InMemoryMedioStore implements MedioStore {
  private medios = new Map<string, MedioPendiente>()
  async addMedio(m: MedioPendiente): Promise<void> { this.medios.set(m.id, m) }
  async getMedios(grupo?: string): Promise<MedioPendiente[]> {
    const todos = [...this.medios.values()]
    return grupo ? todos.filter((m) => m.grupo === grupo) : todos
  }
  async putMedio(m: MedioPendiente): Promise<void> { this.medios.set(m.id, m) }
  async removeMedio(id: string): Promise<void> { this.medios.delete(id) }
}
