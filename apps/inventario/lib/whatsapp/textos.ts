// Todo lo que el bot dice, en un solo archivo y en español de Colombia.
//
// Está junto por tres razones:
//   1. Se lee de corrido y se ve si el tono es el mismo en todos los mensajes.
//      Quien recibe esto está parado en una portería, a veces de noche, con una
//      mano ocupada: los textos son cortos y dicen qué hacer.
//   2. Los textos del CONSENTIMIENTO tienen valor legal y hay que poder
//      mostrarlos años después, exactamente como los leyó la persona. Por eso
//      van versionados y con su hash.
//   3. Ningún texto trae un nombre real de persona ni de cliente: este
//      repositorio es público. Los nombres llegan como parámetro en tiempo de
//      ejecución y los ejemplos de la documentación son inventados.

import { recortar, LIMITES } from './mensajes'

/**
 * Cómo se escribe una distancia. SIEMPRE con el número, porque es el dato que
 * la persona va a discutir con su supervisor, y SIEMPRE EN METROS, incluso para
 * 1.240: la tolerancia del punto está en metros, y responder «estás a 1,24 km,
 * la tolerancia es 75 m» obliga a convertir de cabeza para entender si está
 * cerca o lejos. El ADR-01 lo escribe así en sus ejemplos.
 */
export function metros(m: number): string {
  return `${Math.round(m).toLocaleString('es-CO')} m`
}

export function hora(iso: string, zona = 'America/Bogota'): string {
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zona,
  })
}

export const T = {
  // ── Identidad (§5.1) ──────────────────────────────────────────────────────
  pedirDocumento:
    'Hola 👋 Soy el asistente de rondas. Para empezar necesito identificarte: ' +
    'mandame tu *número de documento* (solo los números).',
  documentoNoCuadra:
    'Ese número no me sirve. Mandame tu *número de documento*, solo los dígitos, ' +
    'sin puntos ni espacios.',
  // NUNCA se le dice a un número qué documentos sí existen: sería una forma de
  // averiguar la nómina preguntándole al bot.
  documentoNoEncontrado:
    'No encontré ese documento en el registro de personal. Le aviso a gestión humana ' +
    'para que te ayuden. 🙏',
  vinculado: (nombreCorto: string) => `Listo, *${nombreCorto}* 👍 Quedó vinculado este número.`,
  numeroBloqueado:
    'Este número está inhabilitado para el asistente. Comunicate con tu supervisor.',
  segundoFactor:
    'Ya hay otro número vinculado a tu documento. Te mandé un código al número anterior: ' +
    'escribilo acá para completar el cambio. Si no lo recibís, pedíselo a tu supervisor.',

  // ── Punto (T1) ────────────────────────────────────────────────────────────
  puntoConfirmar: (codigo: string, nombre: string, sede: string) =>
    `Punto *${codigo} — ${nombre}*. Sede: _${sede}_. ¿Empezamos la visita?`,
  puntoNoExiste: (codigo: string) =>
    `No encontré el punto *${codigo}*. Revisá el código del adhesivo o escribí *MIS PUNTOS*.`,
  puntoOtraSede: (sede: string) =>
    `Ese punto está en _${sede}_, que no es tu sede. ¿Querés reportarlo igual como novedad?`,
  visitaYaAbierta: (codigo: string) =>
    `Tenés la visita del punto *${codigo}* sin cerrar. ¿Qué hacemos?`,
  contratoNoVigente:
    'El contrato de esa sede no está vigente, así que sus puntos no se pueden usar. ' +
    'Avisale a tu supervisor.',
  sinPuntosHoy:
    'No tenés puntos asignados para hoy. Si estás en uno, escaneá su QR o escribí el código ' +
    'del adhesivo.',
  listaPuntosCuerpo:
    'Elegí el punto donde estás. Si no aparece, escribí el código del adhesivo.',
  listaPuntosEncabezado: 'Tus puntos de hoy',

  // ── Ubicación (T2) ────────────────────────────────────────────────────────
  pedirUbicacion:
    'Para confirmar que estás en el punto, tocá *Enviar ubicación*. ' +
    'Es una sola vez, no es seguimiento.',
  recordarUbicacion: 'Te falta enviar la ubicación 👆',
  ubicacionOk: (dist: number, radio: number) =>
    `✅ Ubicación confirmada: estás a *${metros(dist)}* del punto (tolerancia ${metros(radio)}).`,
  ubicacionCerca: (dist: number, radio: number) =>
    `Estás a *${metros(dist)}* del punto; la tolerancia es *${metros(radio)}*, o sea ` +
    `*${metros(Math.max(dist - radio, 0))} de más*. ¿Reenviás la ubicación desde el punto?`,
  ubicacionLejos: (dist: number, codigo: string) =>
    `Estás a *${metros(dist)}* del punto *${codigo}*. No puedo abrir la visita desde ahí. ` +
    `Si el punto está mal ubicado en el sistema, escribí *NOVEDAD*.`,
  ubicacionForzada:
    'Anoté que decís estar en el punto. Queda la novedad y tu supervisor la va a revisar. Seguimos.',
  ubicacionNoLlego: (dist: number) =>
    `No pude confirmar que estás en el punto (*${metros(dist)}* de diferencia). ` +
    `Un supervisor lo va a revisar.`,
  ubicacionSinRespuesta:
    'No me llegó la ubicación. Un supervisor va a revisar esta visita.',

  // ── Fotos (T3, T6) ────────────────────────────────────────────────────────
  pedirFotoInicio:
    'Mandame una *foto del punto como está ahora*, antes de empezar. ' +
    'Tomala con la cámara, no de la galería.',
  pedirFotoFin: 'Última: mandame la *foto del punto ya terminado*.',
  recordarFoto: 'Me falta la foto 📷',
  // WhatsApp no distingue el origen de una imagen y le borra el EXIF: esto es
  // un PEDIDO, no un control. El control real lo define el adr-02.
  esoNoEsFoto: 'Eso no es una foto 🙂. Mandame una imagen del punto.',
  fotoGuardada: (tarea?: string) =>
    tarea ? `📷 Foto guardada en _${tarea}_.` : '📷 Foto guardada.',
  sinFoto: 'No me llegó la foto. ¿Seguimos sin ella?',
  sinFotoSeguimos:
    'Seguimos sin la foto. Queda anotado que falta esa evidencia y se va a ver en el reporte.',

  // ── Tareas (T4, T5) ───────────────────────────────────────────────────────
  tareasEncabezado: 'Tareas del punto',
  tareasCuerpo: (codigo: string, nombre: string) =>
    `Punto ${codigo} — ${nombre}. Elegí la tarea que vas a hacer. Te paso el instructivo.`,
  tareasPie: 'Al terminar todas, mandá la foto de cierre.',
  tareasNinguna:
    'Este punto no tiene tareas configuradas para ahora. Mandame la foto de cierre y lo dejo registrado.',
  seguisAhi: '¿Seguís en el punto? Elegí una tarea o escribí *CANCELAR*.',
  vasBien: (tarea: string) => `¿Vas bien con _${tarea}_? Si ya terminaste, tocá *Hecha*.`,
  notaGuardada: 'Anotado 📝',
  medicionConfirmar: (valor: string, tarea: string) =>
    `Anoté *${valor}* en _${tarea}_. ¿Correcto?`,
  audioRecibido: '🎙️ Recibí tu nota de voz, la estoy pasando a texto.',
  audioTranscrito: (texto: string) =>
    `Dice: _«${recortar(texto, 400)}»_. ¿Está bien?`,
  pedirMotivoNoSePudo: '¿Por qué no se pudo?',
  tareaHecha: (tarea: string) => `✅ _${tarea}_ queda como hecha.`,
  tareaNoRealizada: (tarea: string, motivo: string) =>
    `Anotado: _${tarea}_ no se pudo — *${motivo}*. Se abre un ticket al cerrar.`,

  // ── Resumen y cierre (T7–T9) ──────────────────────────────────────────────
  confirmarCierre: (codigo: string) => `¿Confirmás el cierre del punto *${codigo}*?`,
  armandoReporte: '✅ Listo. Estoy armando el reporte, dame un momento.',
  cerrada: (codigo: string, numero: string) =>
    `✅ *Punto ${codigo} cerrado.* Reporte \`${numero}\`.`,
  rondaTerminada: (hechos: number, total: number) =>
    `✅ Punto cerrado. *Terminaste la ronda de hoy*: ${hechos} de ${total} puntos. ¡Gracias!`,
  siguientePunto: (codigo: string, nombre: string) =>
    `➡️ Siguiente: *${codigo} — ${nombre}*. ¿Vamos?`,
  pausa: 'Listo, quedamos en pausa. Cuando estés en el punto, escaneá su QR o escribime.',
  termineHoy: 'Perfecto, cerramos por hoy. Gracias por tu trabajo. 🙌',
  expirada: (codigo: string) =>
    `Cerré la visita del punto *${codigo}* por inactividad. Lo que mandaste quedó guardado; ` +
    `un supervisor la va a revisar.`,
  cancelada: (codigo: string) =>
    `Cancelé la visita del punto *${codigo}*. Lo que mandaste quedó guardado.`,
  cancelarConfirmar: '¿Seguro que cancelo la visita? Lo que ya mandaste no se borra.',

  // ── Agente y jornada (§7) ─────────────────────────────────────────────────
  derivadoAgente:
    'Le pasé tu caso a un supervisor. Te escribe desde este mismo número.',
  // No se transfiere una llamada: las llamadas no están soportadas en
  // coexistencia, y prometerlo sería mentir.
  derivadoFueraDeJornada:
    'Le pasé tu caso a un supervisor. Ya terminó la jornada, así que te responde en el próximo turno.',
  turnoPorTerminar: (minutos: number, codigo: string) =>
    `Tu turno termina en *${minutos} minutos*. ¿Cerramos la visita del punto *${codigo}* ` +
    `con lo que ya hiciste?`,
  // El bot NO insiste después de esto. Ni recordatorios, ni plantillas, nada.
  finDeJornada:
    'Terminó tu turno. Dejé la visita guardada como está y tu supervisor la va a revisar. ' +
    'No tenés que hacer nada más hoy.',
  escribeFueraDeJornada:
    'Ya terminó tu turno, no tenés que seguir. Si querés cerrar el punto igual, seguimos.',

  // ── Privacidad (§5.2) ─────────────────────────────────────────────────────
  privacidadEncabezado: 'Tus permisos',
  privacidadCuerpo: (lineas: string[]) =>
    `Esto es lo que autorizaste:\n${lineas.join('\n')}\n\nPodés retirar cualquiera cuando quieras.`,
  consentimientoRetirado: (tipo: string) =>
    `Retiré tu permiso de *${tipo.toLowerCase()}*. Queda registrado con la fecha. ` +
    `Podés volver a darlo cuando quieras.`,
  consentimientoNegado: (tipo: string) =>
    tipo === 'UBICACION'
      ? 'Entendido. Sin ubicación no puedo confirmar que estás en el punto, así que la visita la va ' +
        'a tener que validar tu supervisor. Seguimos igual.'
      : 'Entendido, queda registrado. Seguimos igual y se anota que falta esa evidencia.',

  // ── Ayuda y lo que no se entiende ────────────────────────────────────────
  noEntiendo: 'No te entendí 🙂',
  ayudaEncabezado: 'Qué podés hacer',
  sinPermiso: (que: string) =>
    `Ese comando necesita permiso de ${que}. Si lo necesitás, pedíselo a tu supervisor.`,
} as const

/** Los cuatro textos de consentimiento, VERSIONADOS. El texto íntegro es la
 *  prueba: un «sí» sin el texto que se aceptó no prueba nada (Ley 1581 de 2012).
 *
 *  BIOMETRIA va aparte y NO se pide en el flujo de la visita: la visita por
 *  WhatsApp funciona sin ella. Si algún día el reconocimiento facial llega a
 *  este canal, se pide en un momento propio, con explicación completa y con la
 *  opción real de decir no y seguir trabajando. */
export const CONSENTIMIENTOS = {
  UBICACION: {
    version: 'ubicacion.v1',
    texto:
      'Antes de empezar: para confirmar que estás en el punto voy a pedirte tu *ubicación ' +
      'puntual* en algunos momentos de la visita. No hay seguimiento continuo ni se ve dónde ' +
      'estás fuera de la visita. Se guarda con la visita y la usa tu supervisor para verificar ' +
      'la ronda. Podés pedir que la borremos o retirar este permiso escribiendo *PRIVACIDAD*. ' +
      '¿Aceptás?',
  },
  FOTOS: {
    version: 'fotos.v1',
    texto:
      'Durante la visita te voy a pedir *fotos del punto* (antes, durante y al terminar). Son ' +
      'evidencia del trabajo y quedan guardadas con la visita. No pidas ni mandes fotos de ' +
      'personas sin su permiso. ¿Aceptás?',
  },
  AUDIO: {
    version: 'audio.v1',
    texto:
      'Podés mandarme *notas de voz* en vez de escribir. El audio se guarda con la visita y se ' +
      'pasa a texto automáticamente para armar el reporte. Si preferís no usar audio, escribí y ' +
      'listo. ¿Aceptás?',
  },
  BIOMETRIA: {
    version: 'biometria.v1',
    texto:
      'Esto es distinto de lo anterior. Un dato *biométrico* (tu rostro) es un *dato sensible* ' +
      'según la Ley 1581 de 2012 y necesita tu autorización explícita y por separado. Se usaría ' +
      'solo para confirmar que quien hace la ronda sos vos, se guarda cifrado y *podés negarte ' +
      'sin ninguna consecuencia*: en ese caso la verificación la hace tu supervisor. ¿Autorizás ' +
      'el uso de tu dato biométrico?',
  },
} as const

export type TipoConsentimiento = keyof typeof CONSENTIMIENTOS

/** La ayuda depende del estado: decirle «escaneá un QR» a alguien que está a
 *  mitad de una visita no ayuda, estorba. */
export function ayuda(estado: string, puedeCrearQr: boolean): string {
  const comun = [
    '*MIS PUNTOS* — los puntos que tenés hoy',
    '*NOVEDAD* — reportar algo que viste',
    '*HABLAR CON SUPERVISOR* — que te atienda una persona',
    '*PRIVACIDAD* — ver o retirar tus permisos',
  ]
  const porEstado: Record<string, string[]> = {
    SIN_VISITA: ['Escaneá el QR del punto, o escribí su código (por ejemplo *PUNTO K7M-4QX9*)'],
    ESPERA_IDENTIDAD: ['Mandame tu *número de documento* para identificarte'],
    UBICACION_VALIDADA: ['Mandame la *foto del punto* para empezar'],
    FOTO_INICIO_OK: ['Elegí una tarea de la lista'],
    EN_EJECUCION: [
      'Mandame texto, fotos, mediciones o notas de voz: todo se guarda en la tarea en curso',
      '*SIGUIENTE* — terminar el punto y pedir la foto de cierre',
      '*CANCELAR* — cancelar la visita',
    ],
    RESUMEN: ['Tocá *Confirmar* para cerrar, o *Corregir* para cambiar algo'],
  }
  const lineas = [...(porEstado[estado] ?? []), ...comun]
  if (puedeCrearQr) lineas.push('*CREAR QR* — crear un punto nuevo y su código')
  return recortar(`${T.ayudaEncabezado}:\n\n${lineas.map((l) => `• ${l}`).join('\n')}`, LIMITES.interactivoCuerpo)
}

/** El resumen de la visita (T7). Es la PRUEBA de lo que la persona vio antes de
 *  confirmar, así que se guarda textual en el evento `RESUMEN_ENVIADO`. */
export function resumen(datos: {
  codigo: string
  nombre: string
  desde: string
  hasta: string
  minutos: number
  distanciaM: number | null
  hechas: string[]
  noRealizadas: { titulo: string; motivo: string }[]
  fotos: number
  notasVoz: number
  zona?: string
}): string {
  const l: string[] = [`*Resumen — ${datos.codigo} ${datos.nombre}*`]
  l.push(`🕒 ${hora(datos.desde, datos.zona)} a ${hora(datos.hasta, datos.zona)} (${datos.minutos} min)`)
  if (datos.distanciaM !== null) l.push(`📍 A ${metros(datos.distanciaM)} del punto`)
  if (datos.hechas.length) l.push(`✅ Hechas: ${datos.hechas.join(', ')}`)
  for (const n of datos.noRealizadas) l.push(`⚠️ No se pudo: ${n.titulo} — _${n.motivo}_`)
  const medios: string[] = []
  if (datos.fotos) medios.push(`📷 ${datos.fotos} ${datos.fotos === 1 ? 'foto' : 'fotos'}`)
  if (datos.notasVoz) medios.push(`🎙️ ${datos.notasVoz} ${datos.notasVoz === 1 ? 'nota de voz' : 'notas de voz'}`)
  if (medios.length) l.push(medios.join(' · '))
  l.push('')
  l.push('¿Confirmás para cerrar?')
  return recortar(l.join('\n'), LIMITES.interactivoCuerpo)
}
