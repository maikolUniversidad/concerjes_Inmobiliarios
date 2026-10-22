// Los intents de la cola offline y el armado del payload de cada RPC.
//
// Un solo camino de escritura para los tres canales (ADR-E), y UN solo sitio
// donde se decide el ORDEN en que se envían (ADR-D): la evidencia antes del
// cierre, porque el cierre valida los mínimos de foto y si llega primero la
// visita queda incompleta por un problema de red.
//
// Por qué el orden vive aquí y no en la PWA: si cada app lo escribiera, la cola
// se desordenaría entre apps, y la §1.1 del complemento 2 lo pone explícito
// («máquina de estados de la visita y el orden de los intents de la cola …
// tiene que ser idéntica o la cola se desordena entre apps»).
//
// Los ids los genera el dispositivo y las RPC son IDEMPOTENTES por ese id: un
// reintento con mala señal no duplica una visita con todas sus fotos.

import type { VisitaLocal } from './maquina'

export const INTENT_VISITA    = 'ronda:visita'
export const INTENT_RESPUESTA = 'ronda:respuesta'
export const INTENT_EVIDENCIA = 'ronda:evidencia'
export const INTENT_FIRMA     = 'ronda:firma'
export const INTENT_CIERRE    = 'ronda:cierre'
export const INTENT_NOVEDAD   = 'ronda:novedad'

export type KindIntent =
  | typeof INTENT_VISITA | typeof INTENT_RESPUESTA | typeof INTENT_EVIDENCIA
  | typeof INTENT_FIRMA | typeof INTENT_CIERRE | typeof INTENT_NOVEDAD

/** Qué RPC atiende cada intent. Con esto la app registra los manejadores en el
 *  `PushRegistry` de `packages/offline` sin repetir los nombres. */
export const RPC_DE_INTENT: Record<KindIntent, string> = {
  [INTENT_VISITA]:    'ronda_registrar_visita',
  [INTENT_RESPUESTA]: 'ronda_responder_paso',
  [INTENT_EVIDENCIA]: 'ronda_adjuntar_evidencia',
  [INTENT_FIRMA]:     'ronda_firmar',
  [INTENT_CIERRE]:    'ronda_cerrar_visita',
  [INTENT_NOVEDAD]:   'ronda_reportar_novedad',
}

export interface Intent {
  kind: KindIntent
  payload: Record<string, unknown>
}

/** Lo que identifica a quien escribe, que va en todos los payloads. */
export interface Actor {
  personaId: string
  sesionId?: string | null
}

export function payloadVisita(v: VisitaLocal, a: Actor): Record<string, unknown> {
  return {
    p_visita: v.id,
    p_punto: v.puntoId,
    p_plantilla: v.plantillaId,
    p_plantilla_codigo: v.plantillaCodigo ?? null,
    p_asignacion: v.asignacionId ?? null,
    p_qr: v.qrId ?? null,
    p_apertura_modo: v.aperturaModo,
    p_canal: v.canal,
    p_lat: v.lat ?? null,
    p_lng: v.lng ?? null,
    p_precision: v.precisionMetros ?? null,
    p_inicio_dispositivo: v.inicio.tDispositivo,
    p_motivo_fuera: v.motivoFueraGeocerca ?? null,
    p_offline: v.offline,
    p_persona: a.personaId,
    p_sesion: a.sesionId ?? null,
  }
}

export function payloadRespuesta(
  v: VisitaLocal, pasoId: string, a: Actor,
): Record<string, unknown> {
  const r = v.respuestas[pasoId]
  if (!r) throw new Error(`La visita no tiene respuesta para el paso ${pasoId}`)
  const valor: Record<string, unknown> = {}
  if (r.casilla) valor.casilla = r.casilla
  if (r.texto != null) valor.texto = r.texto
  if (r.numero != null) valor.numero = r.numero
  if (r.opciones) valor.opciones = r.opciones
  if (r.transcripcion) valor.transcripcion = r.transcripcion
  if (r.entidadTipo) valor.entidad_tipo = r.entidadTipo
  if (r.entidadId) valor.entidad_id = r.entidadId
  if (r.entidadCodigo) valor.entidad_codigo = r.entidadCodigo
  return {
    p_visita: v.id,
    p_paso: pasoId,
    p_id: r.id,
    p_valor: valor,
    p_motivo: r.motivo ?? null,
    p_omitido: r.omitido,
    p_omision: r.omisionMotivo ?? null,
    p_dispositivo: r.marca.tDispositivo,
    p_persona: a.personaId,
    p_sesion: a.sesionId ?? null,
  }
}

export function payloadEvidencia(
  v: VisitaLocal, evId: string, a: Actor,
): Record<string, unknown> {
  const e = v.evidencias.find((x) => x.id === evId)
  if (!e) throw new Error(`La visita no tiene la evidencia ${evId}`)
  // La respuesta a la que pertenece: su id lo generó este mismo celular, así
  // que la evidencia sabe de quién es aunque nada haya subido todavía.
  const respuestaId = v.respuestas[e.pasoId]?.id ?? null
  return {
    p_id: e.id,
    p_visita: v.id,
    p_respuesta: respuestaId,
    p_tipo: e.tipo,
    p_path: e.rutaArchivo ?? null,
    p_meta: {
      mime: e.mime ?? null,
      tamano: e.tamano ?? null,
      ancho: e.ancho ?? null,
      alto: e.alto ?? null,
      duracion_seg: e.duracionSeg ?? null,
      sha256: e.sha256,
      hash_perceptual: e.hashPerceptual ?? null,
      origen: e.origen,
      qr_detectado: e.qrDetectado ?? null,
      lat: e.lat ?? null,
      lng: e.lng ?? null,
      precision_metros: e.precisionMetros ?? null,
      capturado_dispositivo: e.capturadoDispositivo ?? null,
    },
    p_persona: a.personaId,
    p_sesion: a.sesionId ?? null,
  }
}

export function payloadFirma(
  v: VisitaLocal, quien: FirmaQuien, a: Actor,
): Record<string, unknown> {
  const f = v.firmas.find((x) => x.quien === quien)
  if (!f) throw new Error(`La visita no tiene la firma de ${quien}`)
  return {
    p_visita: v.id,
    p_quien: f.quien,
    p_metodo: f.metodo,
    p_trazo_path: f.rutaTrazo ?? null,
    p_nombre: f.nombre ?? null,
    p_documento: f.documento ?? null,
    p_motivo: f.alternativaMotivo ?? null,
    p_persona: a.personaId,
    p_sesion: a.sesionId ?? null,
  }
}

export type FirmaQuien = 'TRABAJADOR' | 'CLIENTE' | 'SUPERVISOR'

export function payloadCierre(v: VisitaLocal, a: Actor): Record<string, unknown> {
  return {
    p_visita: v.id,
    p_fin_dispositivo: v.fin?.tDispositivo ?? null,
    p_observacion: v.observacion ?? null,
    p_motivo_incompleta: v.incompletaMotivo ?? null,
    p_persona: a.personaId,
    p_sesion: a.sesionId ?? null,
  }
}

export function payloadNovedad(
  v: VisitaLocal, novedadId: string, a: Actor, respuestaId?: string | null,
): Record<string, unknown> {
  const n = v.novedades.find((x) => x.id === novedadId)
  if (!n) throw new Error(`La visita no tiene la novedad ${novedadId}`)
  return {
    p_id: n.id,
    p_visita: v.id,
    p_clase: n.clase,
    p_titulo: n.titulo,
    p_descripcion: n.descripcion ?? null,
    p_prioridad: n.prioridad,
    p_respuesta: respuestaId ?? null,
    p_maquinaria: n.maquinariaId ?? null,
    p_persona: a.personaId,
    p_sesion: a.sesionId ?? null,
  }
}

/**
 * Todos los intents de una visita, EN ORDEN. Este orden es el contrato con la
 * cola:
 *
 *   1. la visita (crea la fila de la que todo lo demás cuelga);
 *   2. las respuestas, en el orden de los pasos;
 *   3. la evidencia de cada respuesta — después de su respuesta, porque la
 *      evidencia apunta a `respuesta_id`;
 *   4. las firmas;
 *   5. las novedades;
 *   6. el cierre, de último, porque valida los mínimos de foto.
 *
 * Los ids de la visita, de cada respuesta y de cada evidencia los genera el
 * DISPOSITIVO, así que la evidencia puede decir de qué respuesta es sin que
 * nada haya subido todavía, y un reintento no duplica nada (las RPC son
 * idempotentes por ese id).
 */
export function intentsDeVisita(v: VisitaLocal, a: Actor): Intent[] {
  const lista: Intent[] = [{ kind: INTENT_VISITA, payload: payloadVisita(v, a) }]

  for (const paso of v.pasos) {
    if (!v.respuestas[paso.id]) continue
    lista.push({ kind: INTENT_RESPUESTA, payload: payloadRespuesta(v, paso.id, a) })
    for (const e of v.evidencias.filter((x) => x.pasoId === paso.id)) {
      lista.push({
        kind: INTENT_EVIDENCIA,
        payload: payloadEvidencia(v, e.id, a),
      })
    }
  }
  // Evidencia que no cuelga de ningún paso contestado (una foto de contexto).
  for (const e of v.evidencias) {
    if (v.respuestas[e.pasoId]) continue
    lista.push({ kind: INTENT_EVIDENCIA, payload: payloadEvidencia(v, e.id, a) })
  }
  for (const f of v.firmas) {
    lista.push({ kind: INTENT_FIRMA, payload: payloadFirma(v, f.quien, a) })
  }
  for (const n of v.novedades) {
    lista.push({
      kind: INTENT_NOVEDAD,
      payload: payloadNovedad(
        v, n.id, a, n.pasoId ? v.respuestas[n.pasoId]?.id ?? null : null),
    })
  }
  if (v.estado === 'COMPLETADA' || v.estado === 'INCOMPLETA') {
    lista.push({ kind: INTENT_CIERRE, payload: payloadCierre(v, a) })
  }
  return lista
}

/** Las rutas del bucket `rondas` (ADR-C). Un solo sitio que las arma, para que
 *  la política de storage y el cliente no puedan discrepar. */
export function rutaEvidencia(visitaId: string, nombreArchivo: string): string {
  return `${visitaId}/${nombreArchivo}`
}
export function rutaEvidenciaDePaso(
  visitaId: string, respuestaId: string, nombreArchivo: string,
): string {
  return `${visitaId}/${respuestaId}/${nombreArchivo}`
}
export function rutaReporte(visitaId: string, numero: string): string {
  return `reportes/${visitaId}/${numero}.pdf`
}
export function rutaFirma(visitaId: string, quien: string): string {
  return `${visitaId}/firmas/${quien.toLowerCase()}.png`
}
