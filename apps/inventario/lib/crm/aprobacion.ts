// El candado de F11: una respuesta sugerida por la IA NUNCA se envía sola.
//
// Por qué esto es un módulo aparte y no tres líneas dentro de la server action:
// porque es la regla que no se negocia del ADR-02 §4 y del criterio de
// aceptación de la Fase 4 del documento 00, y una regla que no se negocia tiene
// que poder PROBARSE sola, sin montar Next, sin sesión y sin base. Acá es una
// función pura y hay una prueba por cada forma de intentar saltársela
// (tests/inventario/crm-aprobacion.test.ts).
//
// CÓMO ESTÁN PUESTOS LOS CANDADOS — son tres, en tres capas distintas, y
// ninguno es un `if` en la pantalla:
//
//   1. ESTRUCTURAL. `lib/crm/ia.ts`, que es lo único que habla con el modelo,
//      no importa nada con lo que se pueda enviar un mensaje. No es que no lo
//      llame: es que no lo tiene. Hay una prueba que lee el archivo y falla si
//      alguien agrega el import (crm-sin-envio-automatico.test.ts).
//   2. AQUÍ. `prepararEnvio()` es el único armador del payload de salida del
//      CRM: la server action lo llama y no arma el payload a mano. Sin un
//      usuario que apruebe, devuelve error y no hay nada que mandar.
//   3. EN LA BASE. `crm_respuesta_aprobar()` EXIGE `p_aprobado_por` no nulo y
//      que exista en `usuarios`, y es la única función de la migración de F11
//      que encola. Ni la llave de servicio puede fabricar una aprobación sin
//      poner el nombre de una persona de verdad.
//
// Y una cosa más, que es fácil de perder de vista: aprobar NO se salta el
// portero de F9. El texto aprobado sigue saliendo por `whatsapp_encolar()`, así
// que si está fuera de la ventana de 24 horas, fuera de la jornada o sin
// consentimiento, nace OMITIDO_* y no sale. Una persona puede aprobar un texto;
// no puede autorizar escribirle a alguien a las once de la noche.

/** Lo que se sabe del caso en el momento de aprobar. */
export interface CasoParaAprobar {
  id: string
  numero: string
  estado: 'NUEVO' | 'EN_TRAMITE' | 'EN_ESPERA' | 'RESUELTO' | 'CERRADO'
  conversacionId: string | null
  /** El borrador que redactó el modelo, si hubo. */
  respuestaIa: string | null
  /** Cuántos mensajes de la conversación vio el modelo cuando redactó. */
  iaMensajesVistos: number | null
}

export interface PeticionAprobacion {
  caso: CasoParaAprobar
  /** El texto que de verdad se va a mandar: el del modelo, o el que el agente
   *  escribió encima. */
  texto: string
  /** El usuario que aprueba. Sin esto no hay envío. */
  aprobadoPor: string | null | undefined
  /** Cuántos mensajes tiene la conversación AHORA. Si entraron más desde que el
   *  modelo redactó, el borrador está viejo. */
  mensajesAhora?: number | null
  /** El agente ya vio el aviso de «entraron mensajes nuevos» y aun así aprueba. */
  confirmaDesactualizado?: boolean
}

export type ResultadoAprobacion =
  | { ok: false; error: string }
  | {
      ok: true
      /** Lo que se le pasa a `crm_respuesta_aprobar()`. */
      envio: {
        casoId: string
        texto: string
        aprobadoPor: string
        /** 3 y no 5: alguien está esperando una respuesta del otro lado. Las
         *  prioridades 7–9 son del envío masivo de F10. */
        prioridad: number
      }
      /** De dónde salió el texto. Se guarda para medir cuánto corrige la gente
       *  al modelo, que es la única métrica real de si el modelo sirve. */
      origen: 'IA_TAL_CUAL' | 'IA_EDITADA' | 'HUMANO'
      /** Avisos que la pantalla muestra, sin frenar el envío. */
      avisos: string[]
    }

/** Tope de un mensaje de texto de WhatsApp (4.096 caracteres). Se recorta en la
 *  pantalla antes, pero el límite se verifica acá para que no se descubra en la
 *  respuesta de error de Meta. */
export const TOPE_TEXTO = 4096

/**
 * Prepara el envío de una respuesta. Es la ÚNICA forma de armar el payload de
 * salida de un caso, y sin aprobación de una persona devuelve error.
 *
 * Pura: no lee el reloj, no toca la red, no mira la sesión. Lo que decide, lo
 * decide con lo que recibe.
 */
export function prepararEnvio(p: PeticionAprobacion): ResultadoAprobacion {
  // ── El candado, antes que nada ──
  const aprobadoPor = (p.aprobadoPor ?? '').trim()
  if (aprobadoPor === '') {
    return {
      ok: false,
      error: 'Una respuesta sugerida por la IA no se envía sola: la tiene que aprobar una persona.',
    }
  }

  const texto = (p.texto ?? '').trim()
  if (texto === '') {
    return { ok: false, error: 'No hay texto que enviar.' }
  }
  if (texto.length > TOPE_TEXTO) {
    return {
      ok: false,
      error: `El mensaje tiene ${texto.length} caracteres y WhatsApp admite ${TOPE_TEXTO}. Hay que acortarlo.`,
    }
  }

  if (p.caso.estado === 'CERRADO') {
    return { ok: false, error: `El caso ${p.caso.numero} está cerrado: no se le puede responder.` }
  }
  if (!p.caso.conversacionId) {
    return { ok: false, error: `El caso ${p.caso.numero} no tiene conversación: no hay a dónde responder.` }
  }

  // ── De dónde salió el texto ──
  const sugerido = (p.caso.respuestaIa ?? '').trim()
  const origen: 'IA_TAL_CUAL' | 'IA_EDITADA' | 'HUMANO' =
    sugerido === '' ? 'HUMANO' : texto === sugerido ? 'IA_TAL_CUAL' : 'IA_EDITADA'

  // ── Avisos: no frenan, informan ──
  const avisos: string[] = []
  const vistos = p.caso.iaMensajesVistos
  const ahora = p.mensajesAhora
  const desactualizado =
    origen !== 'HUMANO' && typeof vistos === 'number' && typeof ahora === 'number' && ahora > vistos

  if (desactualizado && !p.confirmaDesactualizado) {
    // Esto SÍ frena, y a propósito: el borrador contesta una conversación que
    // ya cambió. Mandarlo tal cual es contestar otra pregunta. Se desbloquea
    // confirmando, no quitando el aviso.
    return {
      ok: false,
      error: `Entraron ${ahora - vistos} mensaje(s) después de que la IA redactó el borrador: `
           + 'volvé a analizar el caso o confirmá que lo mandás así igual.',
    }
  }
  if (desactualizado) {
    avisos.push('El borrador se aprobó sabiendo que había mensajes nuevos sin analizar.')
  }
  if (p.caso.estado === 'RESUELTO') {
    avisos.push('El caso estaba resuelto: responder lo vuelve a abrir en la práctica.')
  }

  return {
    ok: true,
    envio: { casoId: p.caso.id, texto, aprobadoPor, prioridad: 3 },
    origen,
    avisos,
  }
}
