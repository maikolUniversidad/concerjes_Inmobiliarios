// La máquina de estados de una visita por WhatsApp (§4 del ADR-01).
//
// ES UNA FUNCIÓN PURA: `(estado, evento, contexto) → (estado', acciones[])`.
// Sin red, sin base de datos, sin reloj propio. Eso no es elegancia: es lo que
// permite probar las transiciones, los vencimientos y los estados de error en
// una tabla de casos, que es el corazón del módulo y lo que más se rompe solo.
// Quien la usa (`motor.ts`) traduce las acciones a RPC y a filas.
//
// QUIÉN DECIDE QUÉ:
//   · la máquina decide el ESTADO y QUÉ decir;
//   · el portero de la base decide si ese mensaje SALE (ventana, jornada,
//     consentimiento, plantilla). La máquina ni lo intenta: pide el mensaje y
//     la base lo omite con su motivo si no corresponde.
//
// LO QUE NUNCA HACE:
//   · confirmar un cierre en nombre de la persona. Si vence el resumen dos
//     veces, el reporte queda en BORRADOR y lo confirma un supervisor desde la
//     consola. El sistema no firma por nadie.
//   · bloquear el trabajo. Fuera de geocerca, sin foto o sin consentimiento, la
//     visita SIGUE con su novedad anotada. Dejar a alguien atrapado a las dos
//     de la mañana con un botón que no responde es lo que hace que la próxima
//     ronda se haga en papel.

import { type MensajeSaliente, listaPaginada, recortar, LIMITES } from './mensajes'
import { codigoDePunto, documento as leerDocumento, medicion, reconocer, esSaludo } from './comandos'
import { CONSENTIMIENTOS, T, type TipoConsentimiento, ayuda, resumen as armarResumen } from './textos'

export type EstadoConversacion =
  | 'SIN_VISITA'
  | 'PUNTO_IDENTIFICADO'
  | 'UBICACION_VALIDADA'
  | 'FOTO_INICIO_OK'
  | 'EN_EJECUCION'
  | 'FOTO_FIN_OK'
  | 'RESUMEN'
  | 'CONFIRMADA'
  | 'CERRADA'
  | 'ESPERA_IDENTIDAD'
  | 'ESPERA_CONSENTIMIENTO'
  | 'ERROR_UBICACION'
  | 'ERROR_FOTO'
  | 'ESPERA_AGENTE'
  | 'EN_ESPERA_FUERA_DE_JORNADA'
  | 'EXPIRADA'
  | 'CANCELADA'
  | 'CERRADA_CON_NOVEDAD'

export type ClaseEventoMaquina =
  | 'TEXTO'
  | 'BOTON'
  | 'LISTA'
  | 'UBICACION'
  | 'IMAGEN'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENTO'
  | 'STICKER'
  | 'CONTACTO'
  | 'REACCION'
  | 'NO_SOPORTADO'
  /** Lo dispara el cron de vencimientos, no la persona. */
  | 'TEMPORIZADOR'
  /** Faltan 10 minutos para que termine el turno (§7.3 punto 1). */
  | 'AVISO_FIN_JORNADA'
  /** Terminó el turno y la visita sigue abierta (§7.3 punto 2). */
  | 'FIN_JORNADA'

export interface EventoMaquina {
  clase: ClaseEventoMaquina
  texto?: string | null
  /** `button_reply.id` o `list_reply.id`. */
  idRespuesta?: string | null
  lat?: number | null
  lng?: number | null
  nombreUbicacion?: string | null
  direccionUbicacion?: string | null
  mediaId?: string | null
  mime?: string | null
  sha256Declarado?: string | null
  voz?: boolean
  comoDocumento?: boolean
  nombreArchivo?: string | null
  wamid?: string | null
  momento: string
}

export interface TareaCtx {
  /** `ronda_plantilla_pasos.id`. */
  id: string
  titulo: string
  descripcion?: string | null
  tipo: string
  estado: 'PENDIENTE' | 'HECHA' | 'NO_REALIZADA'
  /** Por qué no se pudo. Viene de la respuesta ya guardada, no del contexto de
   *  la vuelta, para que el resumen lo diga igual después de un reinicio. */
  motivo?: string | null
  instructivo?: string | null
  exigeFoto?: boolean
}

export interface PuntoCtx {
  id: string
  codigo: string
  nombre: string
  sedeNombre: string
  radioM: number
  exigeGeocerca: boolean
  duracionMin?: number | null
}

export interface PuntoDelDia {
  codigo: string
  nombre: string
  sedeNombre: string
  estado: 'PENDIENTE' | 'EN_CURSO' | 'CERRADO'
}

/** Una opción del menú configurable (F10, §4.2). La arma el motor leyendo
 *  `crm_menu_para()`, YA FILTRADA por permiso: una opción que aparece y después
 *  dice «no tenés permiso» es una opción mal configurada. */
export interface MenuOpcion {
  id: string
  etiqueta: string
  descripcion?: string | null
  accion:
    | 'MIS_PUNTOS'
    | 'PROXIMA_UBICACION'
    | 'MI_MAPA'
    | 'NOVEDAD'
    | 'PQRS'
    | 'SUPERVISOR'
    | 'PRIVACIDAD'
    | 'AYUDA'
    | 'TEXTO'
  texto?: string | null
}

/** La próxima parada de la ruta de hoy (F10, §4.3). Es lo que devuelve
 *  `ronda_proxima_parada()` de F8: la regla de cuál es la siguiente vive allí y
 *  no se reimplementa acá. */
export type ProximaParada =
  | { estado: 'SIN_RUTA' }
  | { estado: 'RUTA_TERMINADA' }
  | {
      estado: 'PARADA'
      codigo: string
      nombre: string
      comoLlegar?: string | null
      piso?: string | null
      paradasPendientes?: number | null
    }

/** Lo que la máquina necesita saber y no puede averiguar sola. Lo arma el motor
 *  con una consulta por vuelta: la máquina no toca la base. */
export interface ContextoMaquina {
  identificada: boolean
  personaNombreCorto?: string | null
  bloqueada: boolean
  /** ¿Estamos dentro de la jornada de la persona? La máquina lo usa solo para
   *  ELEGIR QUÉ DECIR; quien impide el envío es el portero de la base. */
  jornadaAbierta: boolean
  ventanaAbierta: boolean
  consiente: Record<TipoConsentimiento, boolean>
  intentos: number
  punto?: PuntoCtx | null
  visitaId?: string | null
  visitaNumero?: string | null
  tareas: TareaCtx[]
  tareaActual?: string | null
  puntosDelDia: PuntoDelDia[]
  /** El menú de esta persona (contrato + cargo), ya filtrado por permiso. Vacío
   *  si nadie configuró uno: entonces se responde con la ayuda. */
  menu: MenuOpcion[]
  /** La próxima parada de la ruta de hoy. El motor la trae SOLO cuando el
   *  mensaje la pide (el comando o una opción del menú): es una consulta que un
   *  «hola» no necesita. */
  proximaParada?: ProximaParada | null
  /** La resuelve el motor cuando llega una ubicación, con `ronda_geocerca_evaluar`
   *  —la MISMA función que usa la app propia, para que el número que se le
   *  responde a la persona sea el mismo en los tres canales. */
  geocerca?: { distanciaM: number; dentro: boolean; radioM: number } | null
  /** ¿Existe un punto con el código que escribió? Lo resuelve el motor. */
  puntoBuscado?: { existe: boolean; mismaSede: boolean; punto?: PuntoCtx | null } | null
  /** Hay otra visita abierta en otro punto. */
  visitaAbiertaEnOtroPunto?: { codigo: string } | null
  puedeCrearQr: boolean
  fotos: number
  notasVoz: number
  inicioVisita?: string | null
  transcripcion?: string | null
  /** `crm_conversaciones.contexto`: lo que la máquina se guarda entre vueltas. */
  datos: Record<string, unknown>
}

export type Accion =
  | {
      tipo: 'MENSAJE'
      mensaje: MensajeSaliente
      iniciadoPor: 'BOT' | 'RESPUESTA'
      consentimiento?: TipoConsentimiento
      prioridad?: number
      plantilla?: string
      variables?: string[]
    }
  | { tipo: 'ABRIR_VISITA'; puntoCodigo: string; origen: 'TEXTO' | 'QR' | 'LISTA' }
  | {
      tipo: 'REGISTRAR_UBICACION'
      lat: number
      lng: number
      nombre?: string | null
      direccion?: string | null
      hito: string
      forzada?: boolean
    }
  | {
      tipo: 'GUARDAR_MEDIO'
      mediaId: string
      mime?: string | null
      sha256Declarado?: string | null
      hito: string
      comoDocumento?: boolean
      voz?: boolean
      tareaId?: string | null
    }
  | { tipo: 'RESPONDER_PASO'; pasoId: string; valor: Record<string, unknown>; motivo?: string | null; omitido?: boolean }
  | { tipo: 'CERRAR_VISITA'; motivoIncompleta?: string | null; borrador?: boolean }
  | { tipo: 'ANULAR_VISITA'; motivo: string }
  | { tipo: 'NOVEDAD'; titulo: string; descripcion?: string | null; clase?: string }
  | { tipo: 'IDENTIFICAR'; documento: string }
  | { tipo: 'CONSENTIMIENTO'; tipoDato: TipoConsentimiento; otorgado: boolean }
  | { tipo: 'DERIVAR_AGENTE'; motivo: string }
  | { tipo: 'AVISAR_SUPERVISOR'; motivo: string; detalle?: Record<string, unknown> }
  | { tipo: 'TRANSCRIBIR'; mediaId: string }
  | { tipo: 'RECARGAR_TAREAS' }

export interface Resultado {
  estado: EstadoConversacion
  acciones: Accion[]
  /** Cuántos segundos esperar antes del próximo `TEMPORIZADOR`. `null` = no hay
   *  temporizador (estado final, o nada urgente que recordar). */
  esperaSegundos: number | null
  intentos: number
  datos: Record<string, unknown>
  /** Qué disparó la transición, para `ronda_eventos`. */
  disparador: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporizadores (§4.3). Son CORTOS a propósito: con minutos, la respuesta
// siempre cae dentro de la ventana de 24 horas y no hace falta plantilla.
// ─────────────────────────────────────────────────────────────────────────────
const MIN = 60
export const RELOJES = {
  puntoIdentificado: 10 * MIN,
  ubicacionRecordar: 2 * MIN,
  ubicacionTotal: 5 * MIN,
  fotoRecordar: 4 * MIN,
  fotoTotal: 10 * MIN,
  tareasRecordar: 15 * MIN,
  tareasTotal: 45 * MIN,
  ejecucionPiso: 45 * MIN,
  ejecucionTecho: 180 * MIN,
  resumenPrimero: 15 * MIN,
  resumenSegundo: 45 * MIN,
  identidad: 10 * MIN,
  consentimiento: 15 * MIN,
  errorUbicacion: 30 * MIN,
  errorFoto: 15 * MIN,
  agente: 4 * 60 * MIN,
} as const

/** Dos reintentos antes de pasar al estado de error (§4.1). */
export const REINTENTOS = 2

type Fase = 'RECORDATORIO' | 'VENCIMIENTO'

const faseDe = (d: Record<string, unknown>): Fase =>
  d.fase === 'VENCIMIENTO' ? 'VENCIMIENTO' : 'RECORDATORIO'

function msj(
  mensaje: MensajeSaliente,
  iniciadoPor: 'BOT' | 'RESPUESTA' = 'RESPUESTA',
  extra: Partial<Extract<Accion, { tipo: 'MENSAJE' }>> = {},
): Accion {
  // Prioridad 1 por defecto: al otro lado hay alguien parado en un punto
  // esperando una respuesta. Los avisos masivos de F10 van en 9.
  return { tipo: 'MENSAJE', mensaje, iniciadoPor, prioridad: 1, ...extra }
}

const texto = (t: string, iniciadoPor: 'BOT' | 'RESPUESTA' = 'RESPUESTA'): Accion =>
  msj({ tipo: 'TEXTO', texto: recortar(t, LIMITES.textoCuerpo) }, iniciadoPor)

const botones = (
  cuerpo: string,
  bs: { id: string; texto: string }[],
  iniciadoPor: 'BOT' | 'RESPUESTA' = 'RESPUESTA',
  encabezado?: string,
  pie?: string,
): Accion =>
  msj(
    {
      tipo: 'BOTONES',
      cuerpo: recortar(cuerpo, LIMITES.interactivoCuerpo),
      botones: bs.slice(0, LIMITES.botones).map((b) => ({ id: b.id, texto: recortar(b.texto, LIMITES.botonTexto) })),
      encabezado: encabezado ? recortar(encabezado, LIMITES.encabezado) : undefined,
      pie: pie ? recortar(pie, LIMITES.pie) : undefined,
    },
    iniciadoPor,
  )

/** Devuelve el mismo estado, sin tocar reloj ni intentos. Para las respuestas
 *  que no son una transición (una foto más, una nota, un «anotado»). */
function quieto(
  estado: EstadoConversacion,
  ctx: ContextoMaquina,
  acciones: Accion[],
  disparador: string,
  espera: number | null,
  datos?: Record<string, unknown>,
): Resultado {
  return {
    estado,
    acciones,
    esperaSegundos: espera,
    intentos: ctx.intentos,
    datos: datos ?? ctx.datos,
    disparador,
  }
}

function ir(
  estado: EstadoConversacion,
  acciones: Accion[],
  disparador: string,
  espera: number | null,
  datos: Record<string, unknown> = {},
  intentos = 0,
): Resultado {
  return { estado, acciones, esperaSegundos: espera, intentos, datos, disparador }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listas
// ─────────────────────────────────────────────────────────────────────────────

function listaDePuntos(ctx: ContextoMaquina, pagina = 1): Accion {
  const pendientes = ctx.puntosDelDia.filter((p) => p.estado !== 'CERRADO')
  const { filas } = listaPaginada(
    pendientes.map((p) => ({
      id: `punto:${p.codigo}`,
      titulo: recortar(p.codigo, LIMITES.filaTitulo),
      descripcion: recortar(`${p.nombre} · ${p.sedeNombre}`, LIMITES.filaDescripcion),
    })),
    pagina,
    (n) => `puntos:pag:${n}`,
  )
  return msj({
    tipo: 'LISTA',
    encabezado: T.listaPuntosEncabezado,
    cuerpo: T.listaPuntosCuerpo,
    botonTexto: 'Ver puntos',
    secciones: [{ filas }],
  })
}

function listaDeTareas(ctx: ContextoMaquina, pagina = 1): Accion {
  const p = ctx.punto!
  const pendientes = ctx.tareas.filter((t) => t.estado === 'PENDIENTE')
  const { filas } = listaPaginada(
    pendientes.map((t) => ({
      id: `tarea:${t.id}`,
      titulo: recortar(t.titulo, LIMITES.filaTitulo),
      descripcion: t.descripcion ? recortar(t.descripcion, LIMITES.filaDescripcion) : undefined,
    })),
    pagina,
    (n) => `tareas:pag:${n}`,
  )
  return msj({
    tipo: 'LISTA',
    encabezado: T.tareasEncabezado,
    cuerpo: T.tareasCuerpo(p.codigo, p.nombre),
    pie: T.tareasPie,
    botonTexto: 'Ver tareas',
    secciones: [{ filas }],
  })
}

/** El menú configurable, como lista de WhatsApp. El tope de 10 filas lo
 *  garantiza la base (`crm_menu_para` devuelve 10 como máximo), así que acá no
 *  hay paginación: un menú que necesita dos páginas no es un menú. */
function listaDeMenu(ctx: ContextoMaquina): Accion {
  return msj({
    tipo: 'LISTA',
    encabezado: T.menuEncabezado,
    cuerpo: T.menuCuerpo,
    botonTexto: recortar(T.menuBoton, LIMITES.listaBoton),
    secciones: [
      {
        filas: ctx.menu.slice(0, LIMITES.listaFilas).map((o) => ({
          id: `menu:${o.id}`,
          titulo: recortar(o.etiqueta, LIMITES.filaTitulo),
          descripcion: o.descripcion ? recortar(o.descripcion, LIMITES.filaDescripcion) : undefined,
        })),
      },
    ],
  })
}

/** La próxima ubicación (§4.3). Si falta la foto o la referencia del punto se
 *  usa lo que haya —`ronda_puntos.descripcion`—, que es justo lo que §4.3
 *  prevé; lo que no se hace es inventar un punto cuando no hay ruta. */
function textoProximaParada(ctx: ContextoMaquina): string {
  const p = ctx.proximaParada
  if (!p || p.estado === 'SIN_RUTA') return T.proximaSinRuta
  if (p.estado === 'RUTA_TERMINADA') return T.proximaRutaTerminada
  return T.proximaParada(p.codigo, p.nombre, p.comoLlegar ?? null, p.piso ?? null)
}

function pedirUbicacion(): Accion {
  return msj({ tipo: 'SOLICITUD_UBICACION', cuerpo: T.pedirUbicacion })
}

function pedirConsentimiento(tipo: TipoConsentimiento): Accion {
  const c = CONSENTIMIENTOS[tipo]
  const positivo = tipo === 'BIOMETRIA' ? 'Autorizo' : 'Acepto'
  const negativo = tipo === 'BIOMETRIA' ? 'No autorizo' : 'No acepto'
  return botones(
    c.texto,
    [
      { id: `consent:${tipo}:si`, texto: positivo },
      { id: `consent:${tipo}:no`, texto: negativo },
      { id: `consent:${tipo}:info`, texto: 'Más información' },
    ],
    'RESPUESTA',
  )
}

/** El resumen (T7), armado con lo que el motor trajo. */
function mensajeResumen(ctx: ContextoMaquina, momento: string, corto = false): { accion: Accion; texto: string } {
  const p = ctx.punto!
  const t = corto
    ? T.confirmarCierre(p.codigo)
    : armarResumen({
        codigo: p.codigo,
        nombre: p.nombre,
        desde: ctx.inicioVisita ?? momento,
        hasta: momento,
        minutos: Math.max(
          Math.round((Date.parse(momento) - Date.parse(ctx.inicioVisita ?? momento)) / 60000),
          0,
        ),
        distanciaM: ctx.geocerca?.distanciaM ?? null,
        hechas: ctx.tareas.filter((x) => x.estado === 'HECHA').map((x) => x.titulo),
        noRealizadas: ctx.tareas
          .filter((x) => x.estado === 'NO_REALIZADA')
          .map((x) => ({
            titulo: x.titulo,
            // El motivo guardado manda; el del contexto es el de esta vuelta.
            motivo: x.motivo ?? String(ctx.datos[`motivo:${x.id}`] ?? 'sin motivo'),
          })),
        fotos: ctx.fotos,
        notasVoz: ctx.notasVoz,
      })
  return {
    texto: t,
    accion: botones(t, [
      { id: 'resumen:confirmar', texto: 'Confirmar' },
      { id: 'resumen:corregir', texto: 'Corregir' },
    ]),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// La función
// ─────────────────────────────────────────────────────────────────────────────

export function avanzar(
  estado: EstadoConversacion,
  evento: EventoMaquina,
  ctx: ContextoMaquina,
): Resultado {
  // ── Un número bloqueado recibe UNA respuesta y después se ignora, pero sus
  //    eventos se siguen guardando. Eso lo hace el motor; aquí se decide el
  //    único mensaje.
  if (ctx.bloqueada) {
    const yaAvisado = ctx.datos.avisoBloqueo === true
    return quieto(
      estado,
      ctx,
      yaAvisado ? [] : [texto(T.numeroBloqueado)],
      'BLOQUEADA',
      null,
      { ...ctx.datos, avisoBloqueo: true },
    )
  }

  // ── Fin de jornada (§7.3). Va antes que todo lo demás porque es una
  //    obligación legal, no una preferencia de flujo.
  if (evento.clase === 'FIN_JORNADA') return finDeJornada(estado, ctx)
  if (evento.clase === 'AVISO_FIN_JORNADA') return avisoFinDeJornada(estado, ctx)

  if (evento.clase === 'TEMPORIZADOR') return vencimiento(estado, evento, ctx)

  // ── Identidad. Sin saber quién escribe no se abre ninguna visita (§5.1).
  if (!ctx.identificada) return identidad(estado, evento, ctx)

  // ── Comandos: funcionan SIEMPRE, en cualquier estado. Es lo que evita que
  //    alguien quede atrapado en un paso que no entiende.
  const cmd = evento.clase === 'TEXTO' ? reconocer(evento.texto) : null
  if (cmd) {
    const r = comando(cmd, estado, evento, ctx)
    if (r) return r
  }

  // ── Botones y filas: el id lo emitió el bot, así que es lo único de un
  //    entrante en lo que se puede confiar para enrutar… y aun así se valida
  //    contra lo que el estado espera.
  if ((evento.clase === 'BOTON' || evento.clase === 'LISTA') && evento.idRespuesta) {
    const r = respuestaInteractiva(evento.idRespuesta, estado, evento, ctx)
    if (r) return r
  }

  switch (estado) {
    case 'SIN_VISITA':
    case 'CERRADA':
    case 'CERRADA_CON_NOVEDAD':
    case 'CANCELADA':
    case 'EXPIRADA':
      return sinVisita(evento, ctx)

    case 'PUNTO_IDENTIFICADO':
      // Lo que se está esperando acá es la UBICACIÓN (T2): la visita ya está
      // abierta y la solicitud ya salió.
      if (evento.clase === 'UBICACION') return ubicacion(evento, ctx, 'UBICACION')
      // Esperando «Sí, empezar». Un texto suelto no lo da por aceptado: abrir
      // una visita cambia estado, y eso pide confirmación explícita (§6).
      return quieto(
        'PUNTO_IDENTIFICADO',
        ctx,
        [
          botones(T.puntoConfirmar(ctx.punto!.codigo, ctx.punto!.nombre, ctx.punto!.sedeNombre), [
            { id: `punto:${ctx.punto!.codigo}:si`, texto: 'Sí, empezar' },
            { id: `punto:${ctx.punto!.codigo}:no`, texto: 'No es este punto' },
            { id: 'ayuda', texto: 'Ayuda' },
          ]),
        ],
        'TEXTO_EN_PUNTO_IDENTIFICADO',
        RELOJES.puntoIdentificado,
      )

    case 'ESPERA_CONSENTIMIENTO': {
      const pendiente = consentimientoQueFalta(ctx)
      // Si ya no falta ninguno, la conversación se quedó trabada en este estado
      // (p. ej. el permiso se dio desde la consola): se sigue adelante en vez
      // de volver a preguntar algo que ya está contestado.
      if (!pendiente) {
        return ir('PUNTO_IDENTIFICADO', [pedirUbicacion()], 'CONSENTIMIENTOS_YA_ESTABAN',
          RELOJES.ubicacionRecordar, { ...ctx.datos, fase: 'RECORDATORIO' })
      }
      return quieto('ESPERA_CONSENTIMIENTO', ctx, [pedirConsentimiento(pendiente)],
        'REPETIR_CONSENTIMIENTO', RELOJES.consentimiento)
    }

    case 'UBICACION_VALIDADA':
      return fotoInicio(evento, ctx)

    case 'FOTO_INICIO_OK':
      // Esperando que elija una tarea.
      return quieto('FOTO_INICIO_OK', ctx, [listaDeTareas(ctx)], 'REPETIR_TAREAS', RELOJES.tareasRecordar)

    case 'EN_EJECUCION':
      return ejecucion(evento, ctx)

    case 'FOTO_FIN_OK':
    case 'RESUMEN': {
      const { accion } = mensajeResumen(ctx, evento.momento, true)
      return quieto('RESUMEN', ctx, [accion], 'REPETIR_RESUMEN', RELOJES.resumenPrimero)
    }

    case 'CONFIRMADA':
      // El cierre corre en el trabajador; la persona no tiene que hacer nada.
      return quieto('CONFIRMADA', ctx, [texto(T.armandoReporte)], 'ESPERA_CIERRE', 120)

    case 'ERROR_UBICACION':
      if (evento.clase === 'UBICACION') return ubicacion(evento, ctx, 'REINTENTO')
      return quieto(
        'ERROR_UBICACION',
        ctx,
        [
          botones(T.ubicacionNoLlego(ctx.geocerca?.distanciaM ?? 0), [
            { id: 'ubicacion:reintentar', texto: 'Reintentar' },
            { id: 'novedad', texto: 'Reportar novedad' },
            { id: 'supervisor', texto: 'Hablar supervisor' },
          ]),
        ],
        'REPETIR_ERROR_UBICACION',
        RELOJES.errorUbicacion,
      )

    case 'ERROR_FOTO':
      if (evento.clase === 'IMAGEN') return fotoInicio(evento, ctx)
      return quieto(
        'ERROR_FOTO',
        ctx,
        [
          botones(T.sinFoto, [
            { id: 'foto:sin', texto: 'Continuar sin foto' },
            { id: 'foto:reintentar', texto: 'Reintentar' },
            { id: 'cancelar', texto: 'Cancelar' },
          ]),
        ],
        'REPETIR_ERROR_FOTO',
        RELOJES.errorFoto,
      )

    case 'ESPERA_AGENTE':
      // Mientras espera a una persona, el bot no interfiere: solo acusa recibo.
      // Lo que escriba queda en la conversación, que es lo que el supervisor
      // va a leer.
      return quieto('ESPERA_AGENTE', ctx, [], 'MENSAJE_PARA_AGENTE', RELOJES.agente)

    case 'EN_ESPERA_FUERA_DE_JORNADA':
      // Si la persona escribe por su cuenta, el bot responde y la deja seguir,
      // pero avisa UNA vez. Y la visita queda marcada: el trabajo extra se tiene
      // que ver y se tiene que pagar.
      if (ctx.datos.avisoFueraJornada === true) return ejecucion(evento, ctx)
      return quieto(
        'EN_ESPERA_FUERA_DE_JORNADA',
        ctx,
        [texto(T.escribeFueraDeJornada)],
        'ESCRIBE_FUERA_DE_JORNADA',
        null,
        { ...ctx.datos, avisoFueraJornada: true, fueraDeJornada: true },
      )

    default:
      return quieto(estado, ctx, [texto(ayuda(estado, ctx.puedeCrearQr))], 'NO_ENTIENDO', null)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.1 Identidad
// ─────────────────────────────────────────────────────────────────────────────

function identidad(estado: EstadoConversacion, evento: EventoMaquina, ctx: ContextoMaquina): Resultado {
  if (evento.clase !== 'TEXTO') {
    return ir('ESPERA_IDENTIDAD', [texto(T.pedirDocumento)], 'PIDE_DOCUMENTO', RELOJES.identidad,
      { fase: 'VENCIMIENTO' }, ctx.intentos)
  }
  const doc = leerDocumento(evento.texto)
  if (!doc) {
    const intentos = ctx.intentos + 1
    if (intentos > REINTENTOS) {
      return ir('ESPERA_AGENTE', [texto(T.documentoNoEncontrado), { tipo: 'DERIVAR_AGENTE', motivo: 'IDENTIDAD_NO_RESUELTA' }],
        'IDENTIDAD_AGOTADA', RELOJES.agente, {}, 0)
    }
    return ir('ESPERA_IDENTIDAD', [texto(estado === 'ESPERA_IDENTIDAD' ? T.documentoNoCuadra : T.pedirDocumento)],
      'DOCUMENTO_INVALIDO', RELOJES.identidad, { fase: 'VENCIMIENTO' }, intentos)
  }
  // El motor valida el documento contra el registro de personal: la máquina no
  // sabe quién existe y no debe saberlo.
  return ir('ESPERA_IDENTIDAD', [{ tipo: 'IDENTIFICAR', documento: doc }], 'DOCUMENTO_RECIBIDO',
    RELOJES.identidad, { fase: 'VENCIMIENTO', documento: doc }, ctx.intentos)
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 Comandos
// ─────────────────────────────────────────────────────────────────────────────

function comando(
  cmd: ReturnType<typeof reconocer>,
  estado: EstadoConversacion,
  evento: EventoMaquina,
  ctx: ContextoMaquina,
): Resultado | null {
  switch (cmd) {
    case 'AYUDA':
      return quieto(estado, ctx, [texto(ayuda(estado, ctx.puedeCrearQr))], 'CMD_AYUDA', null)

    case 'MENU':
      // Sin menú configurado se responde la ayuda, no una lista vacía.
      if (!ctx.menu.length) {
        return quieto(estado, ctx, [texto(ayuda(estado, ctx.puedeCrearQr))], 'CMD_MENU_VACIO', null)
      }
      return quieto(estado, ctx, [listaDeMenu(ctx)], 'CMD_MENU', null)

    case 'PROXIMA_UBICACION':
      return quieto(estado, ctx, [texto(textoProximaParada(ctx))], 'CMD_PROXIMA_UBICACION', null)

    case 'MIS_PUNTOS':
      if (!ctx.puntosDelDia.length) {
        return quieto(estado, ctx, [texto(T.sinPuntosHoy)], 'CMD_MIS_PUNTOS_VACIO', null)
      }
      return quieto(estado, ctx, [listaDePuntos(ctx)], 'CMD_MIS_PUNTOS', null)

    case 'PRIVACIDAD': {
      const lineas = (Object.keys(CONSENTIMIENTOS) as TipoConsentimiento[]).map(
        (t) => `${ctx.consiente[t] ? '✅' : '⬜'} ${t.toLowerCase()}`,
      )
      return quieto(
        estado,
        ctx,
        [
          msj({
            tipo: 'LISTA',
            encabezado: T.privacidadEncabezado,
            cuerpo: T.privacidadCuerpo(lineas),
            botonTexto: 'Retirar uno',
            secciones: [
              {
                filas: (Object.keys(CONSENTIMIENTOS) as TipoConsentimiento[])
                  .filter((t) => ctx.consiente[t])
                  .map((t) => ({ id: `privacidad:retirar:${t}`, titulo: recortar(t.toLowerCase(), LIMITES.filaTitulo) }))
                  .concat([{ id: 'privacidad:nada', titulo: 'No retirar nada' }]),
              },
            ],
          }),
        ],
        'CMD_PRIVACIDAD',
        null,
      )
    }

    case 'SUPERVISOR':
      return ir(
        'ESPERA_AGENTE',
        [
          texto(ctx.jornadaAbierta ? T.derivadoAgente : T.derivadoFueraDeJornada),
          { tipo: 'DERIVAR_AGENTE', motivo: 'PEDIDO_POR_LA_PERSONA' },
        ],
        'CMD_SUPERVISOR',
        RELOJES.agente,
        ctx.datos,
      )

    case 'NOVEDAD':
      // Funciona SIN visita abierta: alguien que ve algo roto en el pasillo
      // tiene que poder reportarlo sin abrir una ronda.
      return quieto(
        estado,
        ctx,
        [texto('Contame qué pasó en un mensaje. Si podés, mandame también una foto.')],
        'CMD_NOVEDAD',
        null,
        { ...ctx.datos, novedadAbierta: true },
      )

    case 'CANCELAR':
      if (!ctx.visitaId) {
        return quieto(estado, ctx, [texto(ayuda(estado, ctx.puedeCrearQr))], 'CMD_CANCELAR_SIN_VISITA', null)
      }
      return quieto(
        estado,
        ctx,
        [
          botones(T.cancelarConfirmar, [
            { id: 'cancelar:si', texto: 'Sí, cancelar' },
            { id: 'cancelar:no', texto: 'No, seguir' },
          ]),
        ],
        'CMD_CANCELAR',
        300,
      )

    case 'SIGUIENTE':
      if (estado === 'EN_EJECUCION') return pedirFotoFin(ctx, 'CMD_SIGUIENTE')
      if (ctx.puntosDelDia.some((p) => p.estado !== 'CERRADO')) {
        return quieto(estado, ctx, [listaDePuntos(ctx)], 'CMD_SIGUIENTE_LISTA', null)
      }
      return quieto(estado, ctx, [texto(T.sinPuntosHoy)], 'CMD_SIGUIENTE_VACIO', null)

    case 'CREAR_QR':
      // Exige permiso, y el permiso lo resuelve el motor contra `auth_permiso`.
      // La clave es PLANA (`gestionar_qr_ronda`): la del ADR-01 con punto no
      // existiría en el catálogo de /roles.
      if (!ctx.puedeCrearQr) {
        return quieto(estado, ctx, [texto(T.sinPermiso('administración de puntos'))], 'CMD_CREAR_QR_SIN_PERMISO', null)
      }
      return quieto(
        estado,
        ctx,
        [texto('Para crear un punto necesito tres cosas: la sede, el nombre del punto y su ubicación. Empecemos por el nombre.')],
        'CMD_CREAR_QR',
        600,
        { ...ctx.datos, crearQr: { paso: 'NOMBRE' } },
      )

    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// F10 · Una opción del menú configurable
// ─────────────────────────────────────────────────────────────────────────────
// Cada acción se traduce a algo que el bot YA sabe hacer: el menú no es un
// lenguaje con el que quien lo configura pueda hacer actuar al bot, es una forma
// de elegir y ordenar lo que ya existe. Lo que todavía no existe por este canal
// se dice con claridad en vez de dejar un botón que no responde.
function opcionDeMenu(
  opcion: MenuOpcion,
  estado: EstadoConversacion,
  evento: EventoMaquina,
  ctx: ContextoMaquina,
): Resultado {
  switch (opcion.accion) {
    case 'MIS_PUNTOS':
      return ctx.puntosDelDia.length
        ? quieto(estado, ctx, [listaDePuntos(ctx)], 'MENU_MIS_PUNTOS', null)
        : quieto(estado, ctx, [texto(T.sinPuntosHoy)], 'MENU_MIS_PUNTOS_VACIO', null)

    case 'PROXIMA_UBICACION':
      return quieto(estado, ctx, [texto(textoProximaParada(ctx))], 'MENU_PROXIMA_UBICACION', null)

    case 'NOVEDAD':
      return comando('NOVEDAD', estado, evento, ctx) ?? quieto(estado, ctx, [], 'MENU_NOVEDAD', null)

    case 'SUPERVISOR':
      return comando('SUPERVISOR', estado, evento, ctx) ?? quieto(estado, ctx, [], 'MENU_SUPERVISOR', null)

    case 'PRIVACIDAD':
      return comando('PRIVACIDAD', estado, evento, ctx) ?? quieto(estado, ctx, [], 'MENU_PRIVACIDAD', null)

    case 'AYUDA':
      return quieto(estado, ctx, [texto(ayuda(estado, ctx.puedeCrearQr))], 'MENU_AYUDA', null)

    case 'TEXTO':
      // Un texto fijo que escribió quien configuró el menú (el teléfono de la
      // portería, la instrucción del contrato). No ejecuta nada.
      return quieto(
        estado,
        ctx,
        [texto(recortar(opcion.texto ?? '', LIMITES.textoCuerpo))],
        'MENU_TEXTO',
        null,
      )

    // `MI_MAPA` necesita el enlace firmado de corta duración del ADR-A y `PQRS`
    // la radicación por chat: las dos piden una decisión que no es de F10 (van
    // anotadas en el informe), así que el menú lo dice en vez de fingir.
    case 'MI_MAPA':
    case 'PQRS':
      return quieto(
        estado,
        ctx,
        [texto(T.menuOpcionSinCanal(opcion.etiqueta))],
        'MENU_OPCION_SIN_CANAL',
        null,
      )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Botones y filas
// ─────────────────────────────────────────────────────────────────────────────

function respuestaInteractiva(
  id: string,
  estado: EstadoConversacion,
  evento: EventoMaquina,
  ctx: ContextoMaquina,
): Resultado | null {
  const partes = id.split(':')

  // Un id que no reconocemos NO se adivina: se trata como «no entendí». Es
  // entrada del exterior, no una orden.
  switch (partes[0]) {
    case 'ayuda':
      return quieto(estado, ctx, [texto(ayuda(estado, ctx.puedeCrearQr))], 'BOTON_AYUDA', null)

    case 'supervisor':
      return comando('SUPERVISOR', estado, evento, ctx)

    case 'novedad':
      return comando('NOVEDAD', estado, evento, ctx)

    case 'menu': {
      // `menu:<id de la opción>`. El id lo emitió el bot, pero el menú puede
      // haber cambiado entre que se mandó la lista y que la tocaron: si la
      // opción ya no existe, se vuelve a mostrar el menú en vez de adivinar.
      const opcion = ctx.menu.find((o) => o.id === partes[1])
      if (!opcion) {
        return ctx.menu.length
          ? quieto(estado, ctx, [listaDeMenu(ctx)], 'MENU_OPCION_VIEJA', null)
          : quieto(estado, ctx, [texto(T.menuVacio)], 'MENU_VACIO', null)
      }
      return opcionDeMenu(opcion, estado, evento, ctx)
    }

    case 'puntos':
      // `puntos:pag:N`
      return quieto(estado, ctx, [listaDePuntos(ctx, Number(partes[2]) || 1)], 'PAGINA_PUNTOS', null)

    case 'tareas':
      if (!ctx.punto) return null
      return quieto(estado, ctx, [listaDeTareas(ctx, Number(partes[2]) || 1)], 'PAGINA_TAREAS', null)

    case 'punto': {
      const codigo = partes[1]
      if (!codigo) return null
      if (partes[2] === 'no') {
        return ir('SIN_VISITA', [listaDePuntos(ctx)], 'PUNTO_RECHAZADO', null, {})
      }
      // `punto:CODIGO` (fila de la lista) o `punto:CODIGO:si` (botón).
      return abrirVisita(codigo, partes[2] === 'si' ? 'TEXTO' : 'LISTA', ctx)
    }

    case 'consent': {
      const tipo = partes[1] as TipoConsentimiento
      if (!CONSENTIMIENTOS[tipo]) return null
      if (partes[2] === 'info') {
        return quieto('ESPERA_CONSENTIMIENTO', ctx, [texto(CONSENTIMIENTOS[tipo].texto)],
          'CONSENTIMIENTO_INFO', RELOJES.consentimiento)
      }
      const otorgado = partes[2] === 'si'
      const acciones: Accion[] = [{ tipo: 'CONSENTIMIENTO', tipoDato: tipo, otorgado }]
      if (!otorgado) {
        // Decir no NO bloquea el trabajo. Se registra, se explica qué implica y
        // la visita sigue con su novedad.
        acciones.push(texto(T.consentimientoNegado(tipo)))
        acciones.push({ tipo: 'NOVEDAD', titulo: `Sin consentimiento de ${tipo.toLowerCase()}`, clase: 'OTRO' })
      }
      const consiente = { ...ctx.consiente, [tipo]: otorgado }
      const falta = consentimientoQueFalta({ ...ctx, consiente })
      if (falta) {
        return ir('ESPERA_CONSENTIMIENTO', [...acciones, pedirConsentimiento(falta)],
          'CONSENTIMIENTO_REGISTRADO', RELOJES.consentimiento, ctx.datos)
      }
      // Todos resueltos: a pedir la ubicación.
      return ir('PUNTO_IDENTIFICADO', [...acciones, pedirUbicacion()], 'CONSENTIMIENTOS_COMPLETOS',
        RELOJES.ubicacionRecordar, { ...ctx.datos, fase: 'RECORDATORIO' })
    }

    case 'privacidad': {
      if (partes[1] !== 'retirar') return quieto(estado, ctx, [], 'PRIVACIDAD_SIN_CAMBIO', null)
      const tipo = partes[2] as TipoConsentimiento
      if (!CONSENTIMIENTOS[tipo]) return null
      return quieto(
        estado,
        ctx,
        [{ tipo: 'CONSENTIMIENTO', tipoDato: tipo, otorgado: false }, texto(T.consentimientoRetirado(tipo))],
        'PRIVACIDAD_RETIRADO',
        null,
      )
    }

    case 'ubicacion': {
      if (partes[1] === 'reintentar') {
        return ir('PUNTO_IDENTIFICADO', [pedirUbicacion()], 'UBICACION_REINTENTO',
          RELOJES.ubicacionRecordar, { ...ctx.datos, fase: 'RECORDATORIO' })
      }
      if (partes[1] === 'estoy') {
        // «Estoy en el punto» NO valida la geocerca: pasa igual, con la novedad
        // UBICACION_FORZADA y aviso al supervisor. Es decisión deliberada: no se
        // bloquea el trabajo, se deja rastro.
        return ir(
          'UBICACION_VALIDADA',
          [
            texto(T.ubicacionForzada),
            {
              tipo: 'NOVEDAD',
              titulo: 'Ubicación forzada',
              descripcion: `Declaró estar en el punto a ${Math.round(ctx.geocerca?.distanciaM ?? 0)} m`,
              clase: 'OTRO',
            },
            { tipo: 'AVISAR_SUPERVISOR', motivo: 'UBICACION_FORZADA', detalle: { distanciaM: ctx.geocerca?.distanciaM } },
            ...(ctx.consiente.FOTOS ? [texto(T.pedirFotoInicio)] : [pedirConsentimiento('FOTOS')]),
          ],
          'UBICACION_FORZADA',
          RELOJES.fotoRecordar,
          { ...ctx.datos, fase: 'RECORDATORIO', ubicacionForzada: true },
        )
      }
      return null
    }

    case 'foto': {
      if (partes[1] === 'reintentar') {
        return ir('UBICACION_VALIDADA', [texto(T.pedirFotoInicio)], 'FOTO_REINTENTO',
          RELOJES.fotoRecordar, { ...ctx.datos, fase: 'RECORDATORIO' })
      }
      if (partes[1] === 'sin') {
        return ir(
          'FOTO_INICIO_OK',
          [
            texto(T.sinFotoSeguimos),
            { tipo: 'NOVEDAD', titulo: 'Sin evidencia de inicio', clase: 'OTRO' },
            listaDeTareas(ctx),
          ],
          'SIN_FOTO_INICIO',
          RELOJES.tareasRecordar,
          { ...ctx.datos, fase: 'RECORDATORIO' },
        )
      }
      return null
    }

    case 'tarea': {
      const tareaId = partes[1]
      const tarea = ctx.tareas.find((t) => t.id === tareaId)
      if (!tarea) return null
      if (partes[2] === 'hecha') return tareaHecha(tarea, ctx)
      if (partes[2] === 'nopudo') {
        return quieto(
          'EN_EJECUCION',
          ctx,
          [
            msj({
              tipo: 'LISTA',
              cuerpo: T.pedirMotivoNoSePudo,
              botonTexto: 'Elegir motivo',
              secciones: [
                {
                  filas: [
                    { id: `motivo:${tareaId}:Falta material`, titulo: 'Falta material' },
                    { id: `motivo:${tareaId}:Sin acceso`, titulo: 'Sin acceso' },
                    { id: `motivo:${tareaId}:Equipo dañado`, titulo: 'Equipo dañado' },
                    { id: `motivo:${tareaId}:Otra`, titulo: 'Otra' },
                  ],
                },
              ],
            }),
          ],
          'TAREA_NO_PUDO',
          relojEjecucion(ctx),
          { ...ctx.datos, tareaActual: tareaId },
        )
      }
      // Elegir la tarea: se manda el instructivo y queda en curso.
      return abrirTarea(tarea, ctx)
    }

    case 'motivo': {
      const tareaId = partes[1]
      const motivo = partes.slice(2).join(':') || 'Otra'
      const tarea = ctx.tareas.find((t) => t.id === tareaId)
      if (!tarea) return null
      const datos = { ...ctx.datos, [`motivo:${tareaId}`]: motivo, tareaActual: null }
      const restantes = ctx.tareas.filter((t) => t.id !== tareaId && t.estado === 'PENDIENTE')
      const acciones: Accion[] = [
        // Una CASILLA se contesta NO con su motivo, que es exactamente lo que
        // «no se pudo» significa, y así el CHECK de F4 (motivo obligatorio
        // cuando la casilla va en NO) queda satisfecho. Los demás tipos se
        // omiten con el motivo escrito.
        tarea.tipo === 'CASILLA'
          ? { tipo: 'RESPONDER_PASO' as const, pasoId: tareaId, valor: { casilla: 'NO' }, motivo }
          : { tipo: 'RESPONDER_PASO' as const, pasoId: tareaId, valor: {}, motivo, omitido: true },
        texto(T.tareaNoRealizada(tarea.titulo, motivo)),
        { tipo: 'NOVEDAD', titulo: `${tarea.titulo}: ${motivo}`, clase: 'MANTENIMIENTO' },
        { tipo: 'RECARGAR_TAREAS' },
      ]
      if (restantes.length) {
        return quieto('EN_EJECUCION', ctx, [...acciones, listaDeTareas({ ...ctx, tareas: restantes })],
          'TAREA_NO_REALIZADA', relojEjecucion(ctx), datos)
      }
      // Última tarea: se pide la foto de cierre. El resultado de `pedirFotoFin`
      // se conserva ENTERO —sobre todo su `datos`, que lleva
      // `esperandoFotoFin`—; pisarlo con el `datos` local haría que la foto
      // siguiente se archivara como foto de tarea y la visita no llegara nunca
      // al resumen.
      const fin = pedirFotoFin({ ...ctx, datos }, 'TAREA_NO_REALIZADA_ULTIMA')
      return { ...fin, acciones: [...acciones, ...fin.acciones] }
    }

    case 'resumen': {
      if (partes[1] === 'confirmar') {
        return ir(
          'CONFIRMADA',
          [texto(T.armandoReporte), { tipo: 'CERRAR_VISITA', motivoIncompleta: motivoIncompleta(ctx) }],
          'RESUMEN_CONFIRMADO',
          120,
          { ...ctx.datos, resumenConfirmado: ctx.datos.resumenTexto ?? null },
        )
      }
      if (partes[1] === 'corregir') {
        return ir(
          'EN_EJECUCION',
          [
            msj({
              tipo: 'LISTA',
              cuerpo: '¿Qué querés corregir?',
              botonTexto: 'Elegir',
              secciones: [
                {
                  filas: [
                    { id: 'corregir:tarea', titulo: 'Una tarea' },
                    { id: 'corregir:medicion', titulo: 'Una medición' },
                    { id: 'corregir:foto', titulo: 'Agregar foto' },
                    { id: 'corregir:novedad', titulo: 'Agregar novedad' },
                  ],
                },
              ],
            }),
          ],
          'CORRECCION_SOLICITADA',
          relojEjecucion(ctx),
          ctx.datos,
        )
      }
      return null
    }

    case 'corregir':
      return quieto('EN_EJECUCION', ctx, [listaDeTareas({ ...ctx, tareas: ctx.tareas.map((t) => ({ ...t, estado: 'PENDIENTE' as const })) })],
        'CORRECCION_' + (partes[1] ?? '').toUpperCase(), relojEjecucion(ctx))

    case 'cancelar': {
      if (partes[1] === 'no') {
        return quieto('EN_EJECUCION', ctx, [texto('Listo, seguimos. 👍')], 'CANCELAR_ABORTADO', relojEjecucion(ctx))
      }
      if (partes[1] === 'si' && ctx.visitaId) {
        return ir(
          'CANCELADA',
          [texto(T.cancelada(ctx.punto?.codigo ?? '')), { tipo: 'ANULAR_VISITA', motivo: 'Cancelada por la persona desde WhatsApp' }],
          'CANCELADA',
          null,
          {},
        )
      }
      return null
    }

    case 'confirmar': {
      // Confirmación de una medición (`confirmar:medicion:si|no`).
      if (partes[1] === 'medicion') {
        if (partes[2] === 'si') {
          const pasoId = String(ctx.datos.tareaActual ?? '')
          const valor = ctx.datos.medicionPendiente as Record<string, unknown> | undefined
          if (!pasoId || !valor) return null
          return quieto(
            'EN_EJECUCION',
            ctx,
            [{ tipo: 'RESPONDER_PASO', pasoId, valor }, texto(T.notaGuardada)],
            'MEDICION_CONFIRMADA',
            relojEjecucion(ctx),
            { ...ctx.datos, medicionPendiente: null },
          )
        }
        return quieto('EN_EJECUCION', ctx, [texto('Mandame el valor correcto.')], 'MEDICION_CORREGIR',
          relojEjecucion(ctx), { ...ctx.datos, medicionPendiente: null })
      }
      return null
    }

    case 'siguiente': {
      if (partes[1] === 'si') {
        const prox = ctx.puntosDelDia.find((p) => p.estado === 'PENDIENTE')
        if (prox) return abrirVisita(prox.codigo, 'LISTA', ctx)
        return ir('SIN_VISITA', [texto(T.sinPuntosHoy)], 'SIN_SIGUIENTE', null, {})
      }
      if (partes[1] === 'pausa') {
        return ir('SIN_VISITA', [texto(T.pausa)], 'PAUSA', null, {})
      }
      if (partes[1] === 'fin') {
        return ir('SIN_VISITA', [texto(T.termineHoy)], 'TERMINO_POR_HOY', null, {})
      }
      return null
    }

    default:
      return null
  }
}

/** El primero que falta, o `null` si están todos. Devolver `null` importa: con
 *  un valor por defecto, «ya están todos» se leería como «falta el primero» y
 *  la conversación se quedaría pidiendo permisos para siempre. */
function consentimientoQueFalta(ctx: ContextoMaquina): TipoConsentimiento | null {
  // El de BIOMETRIA NO entra en el flujo de la visita: la visita por WhatsApp
  // funciona sin él, y pedirlo aquí sería mezclarlo con los demás, que es
  // justamente lo que el art. 6 de la Ley 1581 no permite.
  const orden: TipoConsentimiento[] = ['UBICACION', 'FOTOS', 'AUDIO']
  return orden.find((t) => !ctx.consiente[t]) ?? null
}

function faltaAlgunConsentimiento(ctx: ContextoMaquina): boolean {
  return consentimientoQueFalta(ctx) !== null
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 · Identificación del punto
// ─────────────────────────────────────────────────────────────────────────────

function sinVisita(evento: EventoMaquina, ctx: ContextoMaquina): Resultado {
  if (evento.clase === 'TEXTO') {
    const codigo = codigoDePunto(evento.texto)
    if (codigo) return identificarPunto(codigo, ctx)
    // Cualquier mensaje suelto con identidad verificada responde con la lista
    // de puntos del día, que es lo útil (caso (c) de T1).
    if (esSaludo(evento.texto) || !ctx.puntosDelDia.length) {
      return quieto(
        'SIN_VISITA',
        ctx,
        [ctx.puntosDelDia.length ? listaDePuntos(ctx) : texto(T.sinPuntosHoy)],
        'SALUDO',
        null,
      )
    }
    return quieto('SIN_VISITA', ctx, [listaDePuntos(ctx)], 'TEXTO_SUELTO', null)
  }
  if (evento.clase === 'IMAGEN' && ctx.datos.novedadAbierta === true && evento.mediaId) {
    return quieto(
      'SIN_VISITA',
      ctx,
      [
        { tipo: 'GUARDAR_MEDIO', mediaId: evento.mediaId, mime: evento.mime, sha256Declarado: evento.sha256Declarado, hito: 'NOVEDAD', comoDocumento: evento.comoDocumento },
        texto(T.fotoGuardada()),
      ],
      'FOTO_DE_NOVEDAD',
      null,
    )
  }
  return quieto('SIN_VISITA', ctx, [texto(`${T.noEntiendo}\n\n${ayuda('SIN_VISITA', ctx.puedeCrearQr)}`)], 'NO_ENTIENDO', null)
}

function identificarPunto(codigo: string, ctx: ContextoMaquina): Resultado {
  const b = ctx.puntoBuscado
  if (!b || !b.existe) {
    return quieto('SIN_VISITA', ctx, [texto(T.puntoNoExiste(codigo))], 'PUNTO_NO_EXISTE', null)
  }
  if (!b.mismaSede) {
    return quieto(
      'SIN_VISITA',
      ctx,
      [
        botones(T.puntoOtraSede(b.punto?.sedeNombre ?? 'otra sede'), [
          { id: 'novedad', texto: 'Sí, novedad' },
          { id: 'puntos:pag:1', texto: 'Ver mis puntos' },
        ]),
      ],
      'PUNTO_OTRA_SEDE',
      null,
    )
  }
  if (ctx.visitaAbiertaEnOtroPunto) {
    return quieto(
      'SIN_VISITA',
      ctx,
      [
        botones(T.visitaYaAbierta(ctx.visitaAbiertaEnOtroPunto.codigo), [
          { id: `punto:${ctx.visitaAbiertaEnOtroPunto.codigo}:si`, texto: 'Seguir con esa' },
          { id: `punto:${codigo}:si`, texto: 'Abrir la nueva' },
          { id: 'cancelar', texto: 'Cancelar' },
        ]),
      ],
      'VISITA_YA_ABIERTA',
      null,
    )
  }
  const p = b.punto!
  return ir(
    'PUNTO_IDENTIFICADO',
    [
      botones(T.puntoConfirmar(p.codigo, p.nombre, p.sedeNombre), [
        { id: `punto:${p.codigo}:si`, texto: 'Sí, empezar' },
        { id: `punto:${p.codigo}:no`, texto: 'No es este punto' },
        { id: 'ayuda', texto: 'Ayuda' },
      ]),
    ],
    'PUNTO_RECONOCIDO',
    RELOJES.puntoIdentificado,
    { puntoCodigo: p.codigo },
  )
}

function abrirVisita(codigo: string, origen: 'TEXTO' | 'QR' | 'LISTA', ctx: ContextoMaquina): Resultado {
  // Antes de abrir: los consentimientos. Se piden UNA vez, no en cada visita.
  const pendiente = consentimientoQueFalta(ctx)
  if (pendiente) {
    return ir(
      'ESPERA_CONSENTIMIENTO',
      [{ tipo: 'ABRIR_VISITA', puntoCodigo: codigo, origen }, pedirConsentimiento(pendiente)],
      'ABRE_Y_PIDE_CONSENTIMIENTO',
      RELOJES.consentimiento,
      { puntoCodigo: codigo },
    )
  }
  return ir(
    'PUNTO_IDENTIFICADO',
    [{ tipo: 'ABRIR_VISITA', puntoCodigo: codigo, origen }, pedirUbicacion()],
    'VISITA_ABIERTA',
    RELOJES.ubicacionRecordar,
    { puntoCodigo: codigo, fase: 'RECORDATORIO' },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// T2 · Ubicación y geocerca
// ─────────────────────────────────────────────────────────────────────────────

function ubicacion(evento: EventoMaquina, ctx: ContextoMaquina, disparador: string): Resultado {
  if (evento.lat === null || evento.lat === undefined || evento.lng === null || evento.lng === undefined) {
    return quieto('PUNTO_IDENTIFICADO', ctx, [pedirUbicacion()], 'UBICACION_SIN_COORDENADAS', RELOJES.ubicacionTotal)
  }
  const registrar: Accion = {
    tipo: 'REGISTRAR_UBICACION',
    lat: evento.lat,
    lng: evento.lng,
    nombre: evento.nombreUbicacion,
    direccion: evento.direccionUbicacion,
    hito: 'INICIO',
  }
  const geo = ctx.geocerca
  // Un punto que no exige geocerca pasa sin más: hay puntos adentro de un
  // sótano donde el GPS simplemente no sirve.
  if (!geo || !ctx.punto?.exigeGeocerca) {
    return ir(
      'UBICACION_VALIDADA',
      [registrar, ...(ctx.consiente.FOTOS ? [texto(T.pedirFotoInicio)] : [pedirConsentimiento('FOTOS')])],
      disparador + '_SIN_GEOCERCA',
      RELOJES.fotoRecordar,
      { ...ctx.datos, fase: 'RECORDATORIO' },
    )
  }

  if (geo.dentro) {
    return ir(
      'UBICACION_VALIDADA',
      [registrar, texto(T.ubicacionOk(geo.distanciaM, geo.radioM)), texto(T.pedirFotoInicio)],
      disparador + '_DENTRO',
      RELOJES.fotoRecordar,
      { ...ctx.datos, fase: 'RECORDATORIO' },
    )
  }

  // Fuera, pero a menos del DOBLE del radio: se dice la diferencia exacta en
  // metros y se ofrece reenviar. El número es el que la persona va a discutir
  // con su supervisor, así que se dice.
  if (geo.distanciaM <= geo.radioM * 2) {
    return quieto(
      'PUNTO_IDENTIFICADO',
      ctx,
      [
        registrar,
        botones(T.ubicacionCerca(geo.distanciaM, geo.radioM), [
          { id: 'ubicacion:reintentar', texto: 'Reenviar ubicación' },
          { id: 'ubicacion:estoy', texto: 'Estoy en el punto' },
          { id: 'novedad', texto: 'Reportar novedad' },
        ]),
      ],
      disparador + '_CERCA',
      RELOJES.ubicacionTotal,
      { ...ctx.datos, fase: 'VENCIMIENTO' },
    )
  }

  // Fuera por más del doble: no se abre la visita desde ahí.
  return ir(
    'ERROR_UBICACION',
    [
      registrar,
      botones(T.ubicacionLejos(geo.distanciaM, ctx.punto.codigo), [
        { id: 'ubicacion:reintentar', texto: 'Reintentar' },
        { id: 'novedad', texto: 'Reportar novedad' },
        { id: 'supervisor', texto: 'Hablar supervisor' },
      ]),
      { tipo: 'AVISAR_SUPERVISOR', motivo: 'FUERA_DE_GEOCERCA', detalle: { distanciaM: geo.distanciaM, radioM: geo.radioM } },
    ],
    disparador + '_LEJOS',
    RELOJES.errorUbicacion,
    { ...ctx.datos, fase: 'VENCIMIENTO', motivoError: 'FUERA_DE_GEOCERCA' },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 · Foto de inicio
// ─────────────────────────────────────────────────────────────────────────────

function fotoInicio(evento: EventoMaquina, ctx: ContextoMaquina): Resultado {
  if (evento.clase === 'UBICACION') return ubicacion(evento, ctx, 'UBICACION_EXTRA')
  if (evento.clase !== 'IMAGEN' || !evento.mediaId) {
    // Un sticker o un texto NO cuentan como intento: el reloj sigue donde
    // estaba. Gastar un intento por un sticker sería castigar un dedo torpe.
    return quieto('UBICACION_VALIDADA', ctx, [texto(T.esoNoEsFoto)], 'NO_ES_FOTO', RELOJES.fotoTotal)
  }
  return ir(
    'FOTO_INICIO_OK',
    [
      {
        tipo: 'GUARDAR_MEDIO',
        mediaId: evento.mediaId,
        mime: evento.mime,
        sha256Declarado: evento.sha256Declarado,
        hito: 'FOTO_INICIO',
        comoDocumento: evento.comoDocumento,
      },
      ctx.tareas.length ? listaDeTareas(ctx) : texto(T.tareasNinguna),
    ],
    'FOTO_INICIO_OK',
    ctx.tareas.length ? RELOJES.tareasRecordar : RELOJES.fotoRecordar,
    { ...ctx.datos, fase: 'RECORDATORIO' },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// T4 y T5 · Tareas y ejecución
// ─────────────────────────────────────────────────────────────────────────────

function relojEjecucion(ctx: ContextoMaquina): number {
  const base = (ctx.punto?.duracionMin ?? 30) * 2 * MIN
  return Math.min(Math.max(base, RELOJES.ejecucionPiso), RELOJES.ejecucionTecho)
}

/**
 * ¿«Hecha» puede contestar este paso por sí solo?
 *
 * Solo una CASILLA y un TEXTO. Un paso de NUMERO necesita el número, uno de
 * FOTO necesita la foto. Ofrecer «Hecha» ahí sería ofrecer un botón que la base
 * va a rechazar —`ronda_responder_paso` valida el tipo— y el conserje vería un
 * botón que no hace nada. La validación de F4 está bien; lo que hay que hacer es
 * no pedirle lo que no puede dar.
 */
function hechaSirve(tipo: string): boolean {
  return tipo === 'CASILLA' || tipo === 'TEXTO'
}

/** Qué pedirle a la persona según el tipo del paso. */
function quePide(tarea: TareaCtx): string | null {
  switch (tarea.tipo) {
    case 'NUMERO':
      return 'Mandame el valor (por ejemplo *12 bar*).'
    case 'FOTO':
      return 'Mandame la *foto* de esta tarea.'
    case 'VIDEO':
      return 'Mandame el *video* de esta tarea.'
    case 'NOTA_VOZ':
      return 'Mandame una *nota de voz* con lo que viste.'
    case 'ESCANEO':
      return 'Mandame el *código* que escaneaste, o escribilo.'
    case 'SELECCION':
      return 'Contame cuál de las opciones aplica.'
    case 'FIRMA':
      // La firma no se puede hacer por WhatsApp: es de la app propia.
      return 'Esta tarea pide una firma, que no se puede hacer por WhatsApp. ' +
        'Tocá *No se pudo* y tu supervisor la resuelve, o hacela desde la app.'
    default:
      return null
  }
}

function abrirTarea(tarea: TareaCtx, ctx: ContextoMaquina): Resultado {
  const acciones: Accion[] = []
  if (tarea.instructivo) {
    // El instructivo puede pasar de 4.096 caracteres: se parte en varios
    // mensajes en vez de recortarlo, porque lo que se corta es justo el final
    // («y al terminar cerrá la llave»).
    for (const parte of partirInstructivo(tarea.titulo, tarea.instructivo)) acciones.push(texto(parte))
  }
  const pide = quePide(tarea)
  const cuerpo = [
    `_${tarea.titulo}_`,
    tarea.descripcion ?? '',
    pide ?? '',
  ].filter(Boolean).join('\n')
  const bs = [
    ...(hechaSirve(tarea.tipo) ? [{ id: `tarea:${tarea.id}:hecha`, texto: 'Hecha' }] : []),
    { id: `tarea:${tarea.id}:nopudo`, texto: 'No se pudo' },
    { id: 'tareas:pag:1', texto: 'Otra tarea' },
  ]
  acciones.push(botones(cuerpo, bs))
  return ir('EN_EJECUCION', acciones, 'TAREA_ABIERTA', relojEjecucion(ctx), {
    ...ctx.datos,
    tareaActual: tarea.id,
    fase: 'RECORDATORIO',
  })
}

function partirInstructivo(titulo: string, instructivo: string): string[] {
  const t = `*${titulo}*\n${instructivo}`
  const partes: string[] = []
  let resto = [...t]
  while (resto.length > LIMITES.textoCuerpo) {
    partes.push(resto.slice(0, LIMITES.textoCuerpo).join(''))
    resto = resto.slice(LIMITES.textoCuerpo)
  }
  partes.push(resto.join(''))
  return partes
}

function tareaHecha(tarea: TareaCtx, ctx: ContextoMaquina): Resultado {
  // Un botón VIEJO de una tarea que ya se contestó (la persona subió en el chat
  // y volvió a tocar «Hecha») no re-contesta nada: la respuesta es una por paso
  // y pisarla borraría la medición que ya estaba. Se sigue adelante.
  const yaEsta = tarea.estado !== 'PENDIENTE'
  // El valor tiene que corresponder al TIPO del paso: `ronda_responder_paso` lo
  // valida, y con razón. «Hecha» solo contesta una casilla o un texto.
  const valor: Record<string, unknown> = tarea.tipo === 'CASILLA' ? { casilla: 'SI' } : { texto: 'Hecha' }
  const acciones: Accion[] = [
    ...(yaEsta || !hechaSirve(tarea.tipo)
      ? []
      : [{ tipo: 'RESPONDER_PASO' as const, pasoId: tarea.id, valor }]),
    texto(T.tareaHecha(tarea.titulo)),
    { tipo: 'RECARGAR_TAREAS' },
  ]
  const restantes = ctx.tareas.filter((t) => t.id !== tarea.id && t.estado === 'PENDIENTE')
  if (restantes.length) {
    return ir('EN_EJECUCION', [...acciones, listaDeTareas({ ...ctx, tareas: restantes })], 'TAREA_HECHA',
      relojEjecucion(ctx), { ...ctx.datos, tareaActual: null, fase: 'RECORDATORIO' })
  }
  const fin = pedirFotoFin(ctx, 'TAREA_HECHA_ULTIMA')
  return { ...fin, acciones: [...acciones, ...fin.acciones] }
}

function ejecucion(evento: EventoMaquina, ctx: ContextoMaquina): Resultado {
  const tareaId = (ctx.datos.tareaActual as string | null) ?? ctx.tareaActual ?? null
  const tarea = ctx.tareas.find((t) => t.id === tareaId) ?? null
  const reloj = relojEjecucion(ctx)

  // T6 · LA FOTO DE CIERRE. Va antes que todo lo demás: si no, una imagen
  // llegada acá se archivaría como foto de una tarea y la visita nunca pasaría
  // al resumen. Es decir: la persona manda la foto final y el bot le contesta
  // «foto guardada» y la deja esperando para siempre.
  if (ctx.datos.esperandoFotoFin === true) {
    if (evento.clase === 'IMAGEN' && evento.mediaId) {
      const { accion, texto: t } = mensajeResumen(ctx, evento.momento)
      return ir(
        'RESUMEN',
        [
          {
            tipo: 'GUARDAR_MEDIO',
            mediaId: evento.mediaId,
            mime: evento.mime,
            sha256Declarado: evento.sha256Declarado,
            hito: 'FOTO_FIN',
            comoDocumento: evento.comoDocumento,
          },
          accion,
        ],
        'FOTO_FIN_OK',
        RELOJES.resumenPrimero,
        { ...ctx.datos, esperandoFotoFin: false, resumenTexto: t, resumenRepetido: false },
      )
    }
    // Cualquier otra cosa: se vuelve a pedir la foto, sin gastar intento. No se
    // muestra la lista de tareas, que ya están todas resueltas.
    if (evento.clase !== 'TEMPORIZADOR') {
      return quieto('EN_EJECUCION', ctx, [texto(T.pedirFotoFin)], 'ESPERA_FOTO_FIN', RELOJES.fotoRecordar)
    }
  }

  switch (evento.clase) {
    case 'IMAGEN':
      if (!evento.mediaId) break
      return quieto(
        'EN_EJECUCION',
        ctx,
        [
          {
            tipo: 'GUARDAR_MEDIO',
            mediaId: evento.mediaId,
            mime: evento.mime,
            sha256Declarado: evento.sha256Declarado,
            hito: 'TAREA',
            comoDocumento: evento.comoDocumento,
            tareaId,
          },
          texto(T.fotoGuardada(tarea?.titulo)),
        ],
        'FOTO_DE_TAREA',
        reloj,
      )

    case 'AUDIO': {
      if (!evento.mediaId) break
      // Sin consentimiento de audio no se transcribe, pero el archivo SÍ se
      // guarda: es lo que la persona mandó y es evidencia. Lo que no se hace es
      // pasarlo por un tercero.
      const acciones: Accion[] = [
        {
          tipo: 'GUARDAR_MEDIO',
          mediaId: evento.mediaId,
          mime: evento.mime,
          sha256Declarado: evento.sha256Declarado,
          hito: 'TAREA',
          voz: evento.voz,
          tareaId,
        },
      ]
      if (evento.voz && ctx.consiente.AUDIO) {
        acciones.push(texto(T.audioRecibido), { tipo: 'TRANSCRIBIR', mediaId: evento.mediaId })
      } else if (evento.voz) {
        acciones.push(pedirConsentimiento('AUDIO'))
      } else {
        acciones.push(texto(T.notaGuardada))
      }
      return quieto('EN_EJECUCION', ctx, acciones, 'AUDIO_DE_TAREA', reloj)
    }

    case 'VIDEO':
    case 'DOCUMENTO':
      if (!evento.mediaId) break
      return quieto(
        'EN_EJECUCION',
        ctx,
        [
          {
            tipo: 'GUARDAR_MEDIO',
            mediaId: evento.mediaId,
            mime: evento.mime,
            sha256Declarado: evento.sha256Declarado,
            hito: 'TAREA',
            comoDocumento: evento.comoDocumento,
            tareaId,
          },
          texto(T.notaGuardada),
        ],
        'MEDIO_DE_TAREA',
        reloj,
      )

    case 'UBICACION':
      if (evento.lat === null || evento.lat === undefined || evento.lng === null || evento.lng === undefined) break
      // Una ubicación más en medio de la ejecución se guarda como dato del
      // hito, sin volver a validar la geocerca: ya se validó al abrir.
      return quieto(
        'EN_EJECUCION',
        ctx,
        [
          { tipo: 'REGISTRAR_UBICACION', lat: evento.lat, lng: evento.lng, nombre: evento.nombreUbicacion, direccion: evento.direccionUbicacion, hito: 'TAREA' },
          texto('📍 Anoté tu ubicación en la tarea.'),
        ],
        'UBICACION_DE_TAREA',
        reloj,
      )

    case 'TEXTO': {
      const t = (evento.texto ?? '').trim()
      if (!t) break
      if (ctx.datos.novedadAbierta === true) {
        return quieto(
          'EN_EJECUCION',
          ctx,
          [{ tipo: 'NOVEDAD', titulo: recortar(t, 120), descripcion: t }, texto('Anotado como novedad. Se crea el ticket al cerrar el punto.')],
          'NOVEDAD_DESCRITA',
          reloj,
          { ...ctx.datos, novedadAbierta: false },
        )
      }
      // ¿Es una medición? Se CONFIRMA antes de guardarla: un número mal leído
      // en un reporte es un número que alguien va a discutir.
      const med = tarea && (tarea.tipo === 'NUMERO' || tarea.tipo === 'TEXTO') ? medicion(t) : null
      if (med && tarea && tarea.tipo === 'NUMERO') {
        const etiqueta = med.unidad ? `${med.valor} ${med.unidad}` : String(med.valor)
        return quieto(
          'EN_EJECUCION',
          ctx,
          [
            botones(T.medicionConfirmar(etiqueta, tarea.titulo), [
              { id: 'confirmar:medicion:si', texto: 'Sí' },
              { id: 'confirmar:medicion:no', texto: 'Corregir' },
            ]),
          ],
          'MEDICION_PROPUESTA',
          reloj,
          { ...ctx.datos, medicionPendiente: { numero: med.valor, unidad: med.unidad }, tareaActual: tarea.id },
        )
      }
      if (tarea) {
        return quieto(
          'EN_EJECUCION',
          ctx,
          [{ tipo: 'RESPONDER_PASO', pasoId: tarea.id, valor: { texto: t } }, texto(T.notaGuardada)],
          'NOTA_DE_TAREA',
          reloj,
        )
      }
      return quieto('EN_EJECUCION', ctx, [listaDeTareas(ctx)], 'TEXTO_SIN_TAREA', reloj)
    }

    default:
      break
  }
  return quieto('EN_EJECUCION', ctx, [texto(ayuda('EN_EJECUCION', ctx.puedeCrearQr))], 'NO_ENTIENDO_EN_EJECUCION', reloj)
}

// ─────────────────────────────────────────────────────────────────────────────
// T6 y T7 · Foto de cierre y resumen
// ─────────────────────────────────────────────────────────────────────────────

function pedirFotoFin(ctx: ContextoMaquina, disparador: string): Resultado {
  return ir('EN_EJECUCION', [texto(T.pedirFotoFin)], disparador, RELOJES.fotoRecordar, {
    ...ctx.datos,
    esperandoFotoFin: true,
    tareaActual: null,
    fase: 'RECORDATORIO',
  })
}

function motivoIncompleta(ctx: ContextoMaquina): string | null {
  const faltantes: string[] = []
  const pendientes = ctx.tareas.filter((t) => t.estado === 'PENDIENTE')
  if (pendientes.length) faltantes.push(`${pendientes.length} tarea(s) sin contestar`)
  if (!ctx.fotos) faltantes.push('sin fotos')
  if (ctx.datos.ubicacionForzada === true) faltantes.push('ubicación forzada')
  if (!faltantes.length) return null
  return `Cerrada desde WhatsApp con faltantes: ${faltantes.join(', ')}.`
}

// ─────────────────────────────────────────────────────────────────────────────
// T10 · Vencimientos
// ─────────────────────────────────────────────────────────────────────────────

function vencimiento(estado: EstadoConversacion, evento: EventoMaquina, ctx: ContextoMaquina): Resultado {
  const fase = faseDe(ctx.datos)
  const alVencimiento = (d: Record<string, unknown>) => ({ ...d, fase: 'VENCIMIENTO' })

  switch (estado) {
    case 'ESPERA_IDENTIDAD': {
      const intentos = ctx.intentos + 1
      if (intentos > REINTENTOS) {
        return ir('ESPERA_AGENTE', [{ tipo: 'DERIVAR_AGENTE', motivo: 'IDENTIDAD_SIN_RESPUESTA' }],
          'IDENTIDAD_VENCIDA', RELOJES.agente, {}, 0)
      }
      return ir('ESPERA_IDENTIDAD', [texto(T.pedirDocumento, 'BOT')], 'IDENTIDAD_RECORDADA',
        RELOJES.identidad, alVencimiento(ctx.datos), intentos)
    }

    case 'ESPERA_CONSENTIMIENTO':
      // No se insiste: sin consentimiento la visita no arranca y queda anotado.
      // Repetir un pedido de permiso es presionar, y eso vicia el permiso.
      return ir('SIN_VISITA', [], 'CONSENTIMIENTO_SIN_RESPUESTA', null, { consentimientoPendiente: true })

    case 'PUNTO_IDENTIFICADO': {
      // Esperando ubicación (o la confirmación del punto).
      if (fase === 'RECORDATORIO') {
        return quieto('PUNTO_IDENTIFICADO', ctx, [texto(T.recordarUbicacion, 'BOT')], 'UBICACION_RECORDADA',
          RELOJES.ubicacionTotal - RELOJES.ubicacionRecordar, alVencimiento(ctx.datos))
      }
      const intentos = ctx.intentos + 1
      if (intentos > REINTENTOS) {
        return ir(
          'ERROR_UBICACION',
          [
            texto(T.ubicacionSinRespuesta, 'BOT'),
            { tipo: 'AVISAR_SUPERVISOR', motivo: 'UBICACION_SIN_RESPUESTA' },
          ],
          'UBICACION_AGOTADA',
          RELOJES.errorUbicacion,
          alVencimiento(ctx.datos),
          0,
        )
      }
      return ir('PUNTO_IDENTIFICADO', [pedirUbicacion()], 'UBICACION_REPETIDA',
        RELOJES.ubicacionRecordar, { ...ctx.datos, fase: 'RECORDATORIO' }, intentos)
    }

    case 'UBICACION_VALIDADA': {
      // Esperando la foto de inicio.
      if (fase === 'RECORDATORIO') {
        return quieto('UBICACION_VALIDADA', ctx, [texto(T.recordarFoto, 'BOT')], 'FOTO_RECORDADA',
          RELOJES.fotoTotal - RELOJES.fotoRecordar, alVencimiento(ctx.datos))
      }
      const intentos = ctx.intentos + 1
      if (intentos > REINTENTOS) {
        return ir(
          'ERROR_FOTO',
          [
            botones(T.sinFoto, [
              { id: 'foto:sin', texto: 'Continuar sin foto' },
              { id: 'foto:reintentar', texto: 'Reintentar' },
              { id: 'cancelar', texto: 'Cancelar' },
            ], 'BOT'),
          ],
          'FOTO_INICIO_AGOTADA',
          RELOJES.errorFoto,
          alVencimiento(ctx.datos),
          0,
        )
      }
      return ir('UBICACION_VALIDADA', [texto(T.pedirFotoInicio, 'BOT')], 'FOTO_REPETIDA',
        RELOJES.fotoRecordar, { ...ctx.datos, fase: 'RECORDATORIO' }, intentos)
    }

    case 'FOTO_INICIO_OK': {
      // Esperando que elija una tarea.
      if (fase === 'RECORDATORIO') {
        return quieto('FOTO_INICIO_OK', ctx, [texto(T.seguisAhi, 'BOT')], 'TAREAS_RECORDADAS',
          RELOJES.tareasTotal - RELOJES.tareasRecordar, alVencimiento(ctx.datos))
      }
      return expirar(ctx, 'TAREAS_SIN_ELEGIR')
    }

    case 'EN_EJECUCION': {
      if (ctx.datos.esperandoFotoFin === true) {
        // Foto de cierre: a los tres intentos se pasa a RESUMEN igual, con la
        // novedad. No se deja a nadie trancado por una foto.
        if (fase === 'RECORDATORIO') {
          return quieto('EN_EJECUCION', ctx, [texto(T.recordarFoto, 'BOT')], 'FOTO_FIN_RECORDADA',
            RELOJES.fotoTotal - RELOJES.fotoRecordar, alVencimiento(ctx.datos))
        }
        const intentos = ctx.intentos + 1
        if (intentos > REINTENTOS) {
          const { accion, texto: t } = mensajeResumen(ctx, evento.momento)
          return ir(
            'RESUMEN',
            [{ tipo: 'NOVEDAD', titulo: 'Sin evidencia de cierre', clase: 'OTRO' }, accion],
            'FOTO_FIN_AGOTADA',
            RELOJES.resumenPrimero,
            { ...ctx.datos, esperandoFotoFin: false, resumenTexto: t, fase: 'VENCIMIENTO', resumenRepetido: false },
            0,
          )
        }
        return ir('EN_EJECUCION', [texto(T.pedirFotoFin, 'BOT')], 'FOTO_FIN_REPETIDA',
          RELOJES.fotoRecordar, { ...ctx.datos, fase: 'RECORDATORIO' }, intentos)
      }
      // Ejecución: aviso a los dos tercios y después se vence.
      if (fase === 'RECORDATORIO') {
        const tarea = ctx.tareas.find((t) => t.id === (ctx.datos.tareaActual ?? ctx.tareaActual))
        return quieto(
          'EN_EJECUCION',
          ctx,
          [texto(tarea ? T.vasBien(tarea.titulo) : T.seguisAhi, 'BOT')],
          'EJECUCION_AVISO',
          Math.round(relojEjecucion(ctx) / 3),
          alVencimiento(ctx.datos),
        )
      }
      return expirar(ctx, 'EJECUCION_VENCIDA')
    }

    case 'RESUMEN': {
      // Se repite UNA sola vez, acortado, y se reinicia el reloj. A la segunda
      // el reporte queda en BORRADOR y lo confirma un supervisor desde la
      // consola. EL SISTEMA NUNCA CONFIRMA EN NOMBRE DE LA PERSONA.
      if (ctx.datos.resumenRepetido !== true) {
        const { accion } = mensajeResumen(ctx, evento.momento, true)
        return quieto('RESUMEN', ctx, [accion], 'RESUMEN_REPETIDO', RELOJES.resumenSegundo, {
          ...ctx.datos,
          resumenRepetido: true,
        })
      }
      return ir(
        'EXPIRADA',
        [
          { tipo: 'CERRAR_VISITA', motivoIncompleta: 'Sin confirmación del trabajador: vencieron los dos avisos del resumen.', borrador: true },
          { tipo: 'AVISAR_SUPERVISOR', motivo: 'PENDIENTE_CONFIRMACION' },
        ],
        'RESUMEN_SIN_CONFIRMAR',
        null,
        { ...ctx.datos, pendienteConfirmacion: true },
      )
    }

    case 'CONFIRMADA':
      // El cierre falló y se reintenta. La confirmación NO se pierde: la visita
      // se queda en CONFIRMADA y se abre un ticket de soporte.
      return quieto('CONFIRMADA', ctx, [{ tipo: 'CERRAR_VISITA', motivoIncompleta: motivoIncompleta(ctx) }],
        'CIERRE_REINTENTO', 300)

    case 'ERROR_UBICACION':
      return expirar(ctx, 'ERROR_UBICACION_VENCIDO')

    case 'ERROR_FOTO':
      return expirar(ctx, 'ERROR_FOTO_VENCIDO')

    case 'ESPERA_AGENTE':
      return quieto('ESPERA_AGENTE', ctx, [{ tipo: 'AVISAR_SUPERVISOR', motivo: 'CASO_SIN_ATENDER' }],
        'AGENTE_ESCALADO', RELOJES.agente)

    case 'EN_ESPERA_FUERA_DE_JORNADA':
      // Una visita a medias por fin de jornada más de 48 horas se cierra sola
      // como CERRADA_CON_NOVEDAD. No se le vuelve a escribir a nadie por algo
      // de hace dos días.
      return ir(
        'CERRADA_CON_NOVEDAD',
        [
          { tipo: 'CERRAR_VISITA', motivoIncompleta: 'Quedó a medias por fin de jornada y pasaron más de 48 horas.', borrador: true },
          { tipo: 'AVISAR_SUPERVISOR', motivo: 'FIN_JORNADA_48H' },
        ],
        'FIN_JORNADA_48H',
        null,
        {},
      )

    default:
      return quieto(estado, ctx, [], 'TEMPORIZADOR_SIN_EFECTO', null)
  }
}

function expirar(ctx: ContextoMaquina, disparador: string): Resultado {
  return ir(
    'EXPIRADA',
    [
      texto(T.expirada(ctx.punto?.codigo ?? ''), 'BOT'),
      { tipo: 'CERRAR_VISITA', motivoIncompleta: 'Vencida por inactividad desde WhatsApp.', borrador: true },
      { tipo: 'AVISAR_SUPERVISOR', motivo: 'REVISAR_INACTIVIDAD' },
    ],
    disparador,
    null,
    { ...ctx.datos, expirada: true },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.3 Fin de jornada
// ─────────────────────────────────────────────────────────────────────────────

const ABIERTOS: EstadoConversacion[] = [
  'UBICACION_VALIDADA',
  'FOTO_INICIO_OK',
  'EN_EJECUCION',
  'FOTO_FIN_OK',
  'RESUMEN',
]

function avisoFinDeJornada(estado: EstadoConversacion, ctx: ContextoMaquina): Resultado {
  if (!ABIERTOS.includes(estado) || !ctx.punto) {
    return quieto(estado, ctx, [], 'AVISO_FIN_JORNADA_SIN_VISITA', null)
  }
  return quieto(
    estado,
    ctx,
    [
      botones(T.turnoPorTerminar(10, ctx.punto.codigo), [
        { id: 'resumen:confirmar', texto: 'Cerrar ahora' },
        { id: 'jornada:yavoy', texto: 'Ya voy' },
        { id: 'jornada:manana', texto: 'Dejar para mañana' },
      ], 'BOT'),
    ],
    'AVISO_FIN_JORNADA',
    10 * MIN,
  )
}

function finDeJornada(estado: EstadoConversacion, ctx: ContextoMaquina): Resultado {
  if (!ABIERTOS.includes(estado)) {
    return quieto(estado, ctx, [], 'FIN_JORNADA_SIN_VISITA', null)
  }
  // La visita NO se cancela y no se pierde nada: pasa a espera, el reporte se
  // genera como BORRADOR con la marca explícita, y EL BOT DEJA DE ESCRIBIR.
  // Ni recordatorios, ni plantillas, ni «no olvides». Nada.
  //
  // El reloj se pone a 48 horas: pasado eso se cierra sola con novedad, porque
  // no se le vuelve a escribir a alguien por algo de hace dos días.
  return ir(
    'EN_ESPERA_FUERA_DE_JORNADA',
    [
      texto(T.finDeJornada, 'BOT'),
      { tipo: 'CERRAR_VISITA', motivoIncompleta: 'Cerrada por fin de jornada, sin confirmación del trabajador.', borrador: true },
      { tipo: 'AVISAR_SUPERVISOR', motivo: 'FIN_JORNADA' },
    ],
    'FIN_JORNADA',
    48 * 60 * MIN,
    { ...ctx.datos, finJornada: true },
  )
}
