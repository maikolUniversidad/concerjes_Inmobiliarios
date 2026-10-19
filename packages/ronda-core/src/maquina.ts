// La máquina de la visita: abrir, responder, adjuntar, firmar, validar y cerrar.
//
// Sin React, sin Next, sin Capacitor y sin Supabase. Funciones puras que reciben
// un estado y devuelven otro, para que la PWA de `apps/inventario` (React 19) y
// el módulo de `apps/movil` (React 18) ejecuten la MISMA visita (decisión §1.1
// del complemento 2). Quien la use decide cómo guarda el estado (useReducer,
// zustand, IndexedDB); esto no lo sabe ni le importa.
//
// La máquina es la de `ronda_visitas.estado`:
//
//   ABIERTA ──(primera respuesta)──> EN_CURSO ──┬─(todo listo)────> COMPLETADA
//                                               └─(falta algo +     INCOMPLETA
//                                                  motivo)
//
// Y la regla que no se negocia (ADR-02 §2.9): la visita SIEMPRE se puede
// cerrar. Lo que falta se declara, no se bloquea. Dejar a alguien atrapado a
// las dos de la mañana con un botón que no responde es lo que hace que la
// próxima ronda se haga en papel.

import {
  type EvidenciaLocal, type Paso, type RespuestaCasilla, type ValorRespuesta,
  pasoAplica, rangoFotos, validarEvidencia, validarRespuesta,
} from './pasos'
import { type Geocerca } from './geocerca'
import { type MarcaDeTiempo, marcar } from './reloj'

/** UUID sin depender de nada: `crypto.randomUUID` donde esté, y si no un
 *  identificador con la misma forma. Los ids los genera el dispositivo porque
 *  son la llave de idempotencia de las RPC. */
export function nuevoId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const hex = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    s += [8, 13, 18, 23].includes(i) ? '-'
      : i === 14 ? '4'
        : hex[Math.floor(Math.random() * 16)]
  }
  return s
}

export type EstadoVisita =
  | 'ABIERTA' | 'EN_CURSO' | 'COMPLETADA' | 'INCOMPLETA' | 'ANULADA' | 'VENCIDA'

export type IdentidadMetodo = 'CUENTA' | 'ENLACE_PIN' | 'CONSOLA' | 'BOT'

export interface RespuestaLocal {
  /** Lo genera el dispositivo: la evidencia apunta a esta respuesta y sin señal
   *  hay que poder encolar las dos sin esperar al servidor. Se conserva al
   *  corregir, para que la foto siga colgada de la misma respuesta. */
  id: string
  pasoId: string
  casilla?: RespuestaCasilla | null
  texto?: string | null
  numero?: number | null
  opciones?: string[] | null
  transcripcion?: string | null
  entidadTipo?: 'producto' | 'maquinaria' | null
  entidadId?: string | null
  entidadCodigo?: string | null
  motivo?: string | null
  omitido: boolean
  omisionMotivo?: string | null
  marca: MarcaDeTiempo
}

export interface FirmaLocal {
  quien: 'TRABAJADOR' | 'CLIENTE' | 'SUPERVISOR'
  metodo: 'TRAZO' | 'OTP' | 'NINGUNA'
  /** PNG del trazo en data URL mientras no ha subido; después, su ruta. */
  trazo?: string | null
  rutaTrazo?: string | null
  nombre?: string | null
  documento?: string | null
  /** Por qué no fue facial, cuando la plantilla lo ofrecía. La falta de
   *  consentimiento biométrico la rellena la base. */
  alternativaMotivo?: string | null
  marca: MarcaDeTiempo
}

export interface NovedadLocal {
  id: string
  pasoId?: string | null
  clase: 'MANTENIMIENTO' | 'PQRS' | 'SOPORTE'
  titulo: string
  descripcion?: string | null
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'
  maquinariaId?: string | null
}

export interface VisitaLocal {
  /** Lo genera el dispositivo: es la llave de idempotencia de la cola. */
  id: string
  puntoId: string
  puntoNombre: string
  qrId?: string | null
  asignacionId?: string | null
  plantillaId: string
  plantillaCodigo?: string | null
  plantillaNombre?: string | null
  exigeFirma: boolean
  pasos: Paso[]
  estado: EstadoVisita
  aperturaModo: 'QR' | 'MANUAL' | 'ASISTIDA'
  canal: 'APP' | 'WHATSAPP' | 'CONSOLA'
  identidadMetodo: IdentidadMetodo
  personaId: string
  sesionId?: string | null
  geocerca: Geocerca | null
  motivoFueraGeocerca?: string | null
  lat?: number | null
  lng?: number | null
  precisionMetros?: number | null
  inicio: MarcaDeTiempo
  fin?: MarcaDeTiempo | null
  offline: boolean
  respuestas: Record<string, RespuestaLocal>
  evidencias: EvidenciaLocal[]
  firmas: FirmaLocal[]
  novedades: NovedadLocal[]
  observacion?: string | null
  incompletaMotivo?: string | null
}

export interface Falta {
  pasoId?: string
  orden?: number
  titulo: string
  tipo?: string
  falta: 'SIN_RESPONDER' | 'OMITIDO' | 'FOTOS' | 'FIRMA' | 'FIRMA_TRABAJADOR'
  detalle?: string
}

/** Resultado de una operación de la máquina: el estado nuevo, o el problema. */
export type Resultado<T> = { ok: true; visita: T } | { ok: false; error: string }

export interface ArgsAbrir {
  id: string
  puntoId: string
  puntoNombre: string
  plantillaId: string
  plantillaCodigo?: string | null
  plantillaNombre?: string | null
  exigeFirma?: boolean
  pasos: Paso[]
  personaId: string
  identidadMetodo: IdentidadMetodo
  sesionId?: string | null
  aperturaModo: 'QR' | 'MANUAL' | 'ASISTIDA'
  canal?: 'APP' | 'WHATSAPP' | 'CONSOLA'
  qrId?: string | null
  asignacionId?: string | null
  geocerca: Geocerca | null
  motivoFueraGeocerca?: string | null
  lat?: number | null
  lng?: number | null
  precisionMetros?: number | null
  offline?: boolean
  ahora?: Date
}

/**
 * Abre la visita en el dispositivo. Devuelve error cuando la geocerca exige
 * motivo y no hay: la misma regla que el CHECK `ck_visita_fuera_geocerca` de la
 * base, para que la pantalla lo pida antes y no después de subir las fotos.
 */
export function abrirVisita(a: ArgsAbrir): Resultado<VisitaLocal> {
  if (a.geocerca?.exigeMotivo && !(a.motivoFueraGeocerca ?? '').trim()) {
    return { ok: false, error: a.geocerca.mensaje + ' Escribe por qué abres la visita desde aquí.' }
  }
  return {
    ok: true,
    visita: {
      id: a.id,
      puntoId: a.puntoId,
      puntoNombre: a.puntoNombre,
      qrId: a.qrId ?? null,
      asignacionId: a.asignacionId ?? null,
      plantillaId: a.plantillaId,
      plantillaCodigo: a.plantillaCodigo ?? null,
      plantillaNombre: a.plantillaNombre ?? null,
      exigeFirma: a.exigeFirma ?? false,
      pasos: [...a.pasos].sort((x, y) => x.orden - y.orden),
      estado: 'ABIERTA',
      aperturaModo: a.aperturaModo,
      canal: a.canal ?? 'APP',
      identidadMetodo: a.identidadMetodo,
      personaId: a.personaId,
      sesionId: a.sesionId ?? null,
      geocerca: a.geocerca,
      motivoFueraGeocerca: (a.motivoFueraGeocerca ?? '').trim() || null,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
      precisionMetros: a.precisionMetros ?? null,
      inicio: marcar(a.ahora),
      fin: null,
      offline: a.offline ?? false,
      respuestas: {},
      evidencias: [],
      firmas: [],
      novedades: [],
    },
  }
}

const buscarPaso = (v: VisitaLocal, pasoId: string) => v.pasos.find((p) => p.id === pasoId)

/** Cuántas fotos lleva adjuntas un paso. */
export function fotosDe(v: VisitaLocal, pasoId: string): number {
  return v.evidencias.filter((e) => e.pasoId === pasoId && e.tipo === 'FOTO').length
}

/** Los pasos que hay que mostrar: los condicionales solo cuando su condición se
 *  cumple con lo contestado hasta ahora. */
export function pasosVisibles(v: VisitaLocal): Paso[] {
  const r: Record<string, { casilla?: string | null; opciones?: string[] | null }> = {}
  for (const [id, x] of Object.entries(v.respuestas)) {
    r[id] = { casilla: x.casilla ?? null, opciones: x.opciones ?? null }
  }
  return v.pasos.filter((p) => pasoAplica(p, r))
}

export function responderPaso(
  v: VisitaLocal,
  pasoId: string,
  valor: ValorRespuesta,
  opciones: { motivo?: string | null; omitido?: boolean; omisionMotivo?: string | null; ahora?: Date } = {},
): Resultado<VisitaLocal> {
  const paso = buscarPaso(v, pasoId)
  if (!paso) return { ok: false, error: 'Ese paso no es de esta tarea.' }
  if (v.estado === 'COMPLETADA' || v.estado === 'INCOMPLETA') {
    return { ok: false, error: 'La visita ya está cerrada.' }
  }
  const problema = validarRespuesta(paso, valor, {
    motivo: opciones.motivo, omitido: opciones.omitido,
    omisionMotivo: opciones.omisionMotivo, fotos: fotosDe(v, pasoId),
  })
  if (problema) return { ok: false, error: problema }

  const r: RespuestaLocal = {
    // Al corregir se conserva el id: si cambiara, la evidencia ya encolada
    // apuntaría a una respuesta que no existe.
    id: v.respuestas[pasoId]?.id ?? nuevoId(),
    pasoId,
    casilla: valor.casilla ?? null,
    texto: valor.texto ?? null,
    numero: valor.numero ?? null,
    opciones: valor.opciones ?? null,
    transcripcion: valor.transcripcion ?? null,
    entidadTipo: valor.entidad_tipo ?? null,
    entidadId: valor.entidad_id ?? null,
    entidadCodigo: valor.entidad_codigo ?? null,
    motivo: (opciones.motivo ?? '').trim() || null,
    omitido: opciones.omitido ?? false,
    omisionMotivo: (opciones.omisionMotivo ?? '').trim() || null,
    marca: marcar(opciones.ahora),
  }
  return {
    ok: true,
    visita: {
      ...v,
      estado: v.estado === 'ABIERTA' ? 'EN_CURSO' : v.estado,
      respuestas: { ...v.respuestas, [pasoId]: r },
    },
  }
}

export function adjuntarEvidencia(v: VisitaLocal, ev: EvidenciaLocal): Resultado<VisitaLocal> {
  const paso = buscarPaso(v, ev.pasoId)
  if (!paso) return { ok: false, error: 'Ese paso no es de esta tarea.' }
  const problema = validarEvidencia(paso, ev)
  if (problema) return { ok: false, error: problema }
  if (paso.tipo === 'FOTO') {
    const { max } = rangoFotos(paso.config)
    if (fotosDe(v, ev.pasoId) >= max) {
      return { ok: false, error: `Este paso admite hasta ${max} fotos.` }
    }
  }
  // Una foto repetida NO se bloquea aquí: la base la marca y F13 la puntúa.
  // Lo que sí se hace es avisar, y eso es trabajo de la pantalla con
  // `evidenciaRepetidaEnVisita()`.
  return {
    ok: true,
    visita: { ...v, estado: v.estado === 'ABIERTA' ? 'EN_CURSO' : v.estado,
              evidencias: [...v.evidencias, ev] },
  }
}

export function quitarEvidencia(v: VisitaLocal, id: string): VisitaLocal {
  return { ...v, evidencias: v.evidencias.filter((e) => e.id !== id) }
}

/** ¿Esta foto ya está en la visita? Sirve para avisar «esta foto ya la
 *  tomaste», no para impedirlo. */
export function evidenciaRepetidaEnVisita(v: VisitaLocal, sha256: string): EvidenciaLocal | null {
  return v.evidencias.find((e) => e.sha256 === sha256) ?? null
}

export function firmar(v: VisitaLocal, firma: Omit<FirmaLocal, 'marca'>, ahora?: Date): Resultado<VisitaLocal> {
  if (firma.metodo === 'TRAZO' && !(firma.trazo ?? firma.rutaTrazo)) {
    return { ok: false, error: 'Falta el trazo de la firma.' }
  }
  const otras = v.firmas.filter((f) => f.quien !== firma.quien)
  return { ok: true, visita: { ...v, firmas: [...otras, { ...firma, marca: marcar(ahora) }] } }
}

export function agregarNovedad(v: VisitaLocal, n: NovedadLocal): Resultado<VisitaLocal> {
  if (!n.titulo.trim()) return { ok: false, error: 'Describe en una línea qué pasó.' }
  return { ok: true, visita: { ...v, novedades: [...v.novedades, n] } }
}

/**
 * Qué falta para cerrar. Mismas reglas que `ronda_validar_cierre()` en la base:
 * si las dos no coinciden, la pantalla pediría cosas que el servidor no exige
 * (o dejaría cerrar algo que el servidor va a marcar incompleto sin avisar).
 */
export function faltantesCierre(v: VisitaLocal): Falta[] {
  const faltas: Falta[] = []
  for (const paso of pasosVisibles(v)) {
    if (paso.tipo === 'FIRMA') {
      const quien = (paso.config.quien ?? 'trabajador').toUpperCase()
      if (paso.obligatorio && !v.firmas.some((f) => f.quien === quien)) {
        faltas.push({ pasoId: paso.id, orden: paso.orden, titulo: paso.titulo,
                      tipo: paso.tipo, falta: 'FIRMA' })
      }
      continue
    }
    const r = v.respuestas[paso.id]
    if (!r) {
      if (paso.obligatorio) {
        faltas.push({ pasoId: paso.id, orden: paso.orden, titulo: paso.titulo,
                      tipo: paso.tipo, falta: 'SIN_RESPONDER' })
      }
      continue
    }
    if (r.omitido) {
      if (paso.obligatorio) {
        faltas.push({ pasoId: paso.id, orden: paso.orden, titulo: paso.titulo,
                      tipo: paso.tipo, falta: 'OMITIDO',
                      detalle: r.omisionMotivo ?? undefined })
      }
      continue
    }
    if (paso.tipo === 'FOTO') {
      const { min } = rangoFotos(paso.config)
      const n = fotosDe(v, paso.id)
      if (n < min) {
        faltas.push({ pasoId: paso.id, orden: paso.orden, titulo: paso.titulo,
                      tipo: paso.tipo, falta: 'FOTOS', detalle: `${n} de ${min}` })
      }
    }
  }
  if (v.exigeFirma && !v.firmas.some((f) => f.quien === 'TRABAJADOR')) {
    faltas.push({ titulo: 'Firma del trabajador', falta: 'FIRMA_TRABAJADOR' })
  }
  return faltas
}

/** Avance de la visita, para la barra de progreso. */
export function progreso(v: VisitaLocal): { hechos: number; total: number; porcentaje: number } {
  const visibles = pasosVisibles(v).filter((p) => p.tipo !== 'FIRMA')
  const hechos = visibles.filter((p) => {
    const r = v.respuestas[p.id]
    if (!r) return false
    if (r.omitido) return true
    if (p.tipo === 'FOTO') return fotosDe(v, p.id) >= rangoFotos(p.config).min
    return true
  }).length
  const total = visibles.length || 1
  return { hechos, total, porcentaje: Math.round((hechos / total) * 100) }
}

/**
 * Cierra la visita en el dispositivo. Si falta algo, queda INCOMPLETA y hace
 * falta el motivo; nunca se impide cerrar. Eso es lo mismo que hace
 * `ronda_cerrar_visita()`, para que la cola no mande un cierre que el servidor
 * va a rechazar cuando ya no hay nadie mirando la pantalla.
 */
export function cerrarVisita(
  v: VisitaLocal,
  opciones: { observacion?: string | null; motivoIncompleta?: string | null; ahora?: Date } = {},
): Resultado<VisitaLocal> & { faltantes?: Falta[] } {
  if (v.estado === 'COMPLETADA' || v.estado === 'INCOMPLETA') return { ok: true, visita: v }
  const faltantes = faltantesCierre(v)
  if (faltantes.length > 0 && !(opciones.motivoIncompleta ?? '').trim()) {
    return {
      ok: false,
      error: faltantes.length === 1
        ? `Falta «${faltantes[0].titulo}». Puedes cerrar igual, pero hay que escribir por qué queda incompleta.`
        : `Faltan ${faltantes.length} cosas. Puedes cerrar igual, pero hay que escribir por qué queda incompleta.`,
      faltantes,
    }
  }
  return {
    ok: true,
    faltantes,
    visita: {
      ...v,
      estado: faltantes.length === 0 ? 'COMPLETADA' : 'INCOMPLETA',
      fin: marcar(opciones.ahora),
      observacion: (opciones.observacion ?? '').trim() || v.observacion || null,
      incompletaMotivo: faltantes.length === 0
        ? null : (opciones.motivoIncompleta ?? '').trim() || null,
    },
  }
}
