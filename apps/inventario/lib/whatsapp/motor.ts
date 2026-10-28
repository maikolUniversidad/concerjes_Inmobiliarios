import 'server-only'

// El trabajador de entrada: lo que conecta la máquina de estados con la base.
//
// La máquina es pura y no sabe nada de Supabase. Este archivo hace las tres
// cosas que ella no puede: trae el CONTEXTO (una consulta por vuelta),
// ejecuta las ACCIONES (una RPC por acción) y guarda el ESTADO.
//
// Y el enganche con el módulo de rondas es por las MISMAS RPC que usa la PWA:
// `ronda_registrar_visita`, `ronda_responder_paso`, `ronda_adjuntar_evidencia`,
// `ronda_cerrar_visita`, `ronda_reportar_novedad`. Eso no es comodidad: es lo
// que garantiza que la geocerca, el motivo obligatorio cuando se fuerza una
// ubicación y los mínimos de foto se validen IGUAL en los tres canales. Un bot
// con sus propias reglas de negocio sería un segundo sistema.
//
// Presupuesto de tiempo, no de cantidad: se sale ordenadamente a los 50 s
// dejando lo pendiente en la cola, como hace `procesarCorreoSaliente`.

import { randomUUID } from 'node:crypto'
import {
  avanzar,
  type Accion,
  type ContextoMaquina,
  type EstadoConversacion,
  type EventoMaquina,
  type TareaCtx,
} from './maquina'
import { descomponer, esEstado, leerEstado, leerMensaje, tipoMensaje, type EventoCrudo } from './entrada'
import { config } from './config'
import { CONSENTIMIENTOS, type TipoConsentimiento } from './textos'
import { descargarMedio } from './medios'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any

export interface ResultadoEntrada {
  procesados: number
  descartados: number
  errores: number
  mensajesEncolados: number
  incompleto: boolean
}

/** Guarda en la cola los eventos de un POST del webhook. Lo llama la ruta del
 *  webhook y NADA MÁS: su trabajo es verificar la firma, insertar y responder
 *  200 en menos de 300 ms. */
export async function encolarEventos(
  supabase: Sb,
  cuerpo: unknown,
  cuentaId: string | null,
  simulado = false,
): Promise<{ guardados: number; repetidos: number; total: number }> {
  const eventos = descomponer(cuerpo)
  let guardados = 0
  let repetidos = 0
  for (const e of eventos) {
    const { data, error } = await supabase.rpc('whatsapp_evento_registrar', {
      p_cuenta: cuentaId,
      p_dedup: e.dedup,
      p_tipo_campo: e.tipoCampo,
      p_payload: e.payload,
      p_wamid: e.wamid,
      p_wa_id: e.waId,
      p_phone_id: e.phoneNumberId,
      p_timestamp: e.momento,
      p_simulado: simulado,
    })
    // Si la inserción falla se LANZA, para que el webhook responda 500 y Meta
    // reintente. Nunca 200 sobre un evento que no quedó guardado: tiene 7 días
    // para reintentar y después se pierde para siempre.
    if (error) throw new Error(`No se pudo guardar el evento: ${error.message}`)
    if (Number(data) > 0) guardados++
    else repetidos++
  }
  return { guardados, repetidos, total: eventos.length }
}

/** Procesa la cola de entrada. */
export async function procesarEntrada(
  supabase: Sb,
  presupuestoSeg = 50,
  limite = 20,
): Promise<ResultadoEntrada> {
  const hasta = Date.now() + presupuestoSeg * 1000
  const res: ResultadoEntrada = {
    procesados: 0,
    descartados: 0,
    errores: 0,
    mensajesEncolados: 0,
    incompleto: false,
  }

  for (;;) {
    if (Date.now() >= hasta) {
      res.incompleto = true
      break
    }
    const { data, error } = await supabase.rpc('whatsapp_evento_tomar', { p_limite: limite })
    if (error) throw new Error(`No se pudo reclamar la cola de entrada: ${error.message}`)
    const lote = (data ?? []) as any[]
    if (!lote.length) break

    for (const fila of lote) {
      if (Date.now() >= hasta) {
        await supabase.rpc('whatsapp_evento_cerrar', { p_evento: fila.id, p_estado: 'ERROR', p_error: 'Se agotó el presupuesto de tiempo del trabajador.' })
        res.incompleto = true
        continue
      }
      try {
        const r = await procesarUno(supabase, fila)
        res.mensajesEncolados += r.encolados
        if (r.descartado) res.descartados++
        else res.procesados++
      } catch (e) {
        res.errores++
        await supabase.rpc('whatsapp_evento_cerrar', {
          p_evento: fila.id,
          p_estado: 'ERROR',
          p_error: (e instanceof Error ? e.message : 'error').slice(0, 500),
        })
      }
    }
  }
  return res
}

async function procesarUno(supabase: Sb, fila: any): Promise<{ encolados: number; descartado: boolean }> {
  const evento: EventoCrudo = {
    tipoCampo: fila.tipo_campo,
    dedup: fila.dedup_clave,
    wamid: fila.wamid,
    waId: fila.wa_id,
    phoneNumberId: fila.phone_number_id,
    momento: fila.timestamp_meta,
    payload: fila.payload,
  }

  // ── Un `statuses`: actualiza el mensaje saliente y listo. No pasa por la
  //    máquina y es idempotente por diseño.
  if (esEstado(fila.payload)) {
    const st = leerEstado(evento)
    if (st) {
      await supabase.rpc('whatsapp_estado_entrega', {
        p_wamid: st.wamid,
        p_estado: st.estado,
        p_momento: st.momento,
        p_codigo: st.codigoError,
        p_error: st.error,
      })
    }
    await supabase.rpc('whatsapp_evento_cerrar', { p_evento: fila.id, p_estado: 'PROCESADO' })
    return { encolados: 0, descartado: false }
  }

  const msj = leerMensaje(evento)
  if (!msj || !msj.waId) {
    // Cambios de cuenta, calidad del número, estado de plantilla: se guardaron,
    // que es lo que importa, pero no hay máquina que los consuma todavía.
    await supabase.rpc('whatsapp_evento_cerrar', {
      p_evento: fila.id,
      p_estado: 'DESCARTADO',
      p_motivo: `Evento de tipo ${fila.tipo_campo} sin mensaje que procesar.`,
    })
    return { encolados: 0, descartado: true }
  }

  const cuentaId = fila.cuenta_id ?? (await cuentaPorPhoneId(supabase, msj.phoneNumberId))
  if (!cuentaId) {
    await supabase.rpc('whatsapp_evento_cerrar', {
      p_evento: fila.id,
      p_estado: 'DESCARTADO',
      p_motivo: 'No hay ninguna cuenta de WhatsApp que corresponda a ese número.',
    })
    return { encolados: 0, descartado: true }
  }

  const { data: conv, error: eConv } = await supabase.rpc('crm_conversacion_resolver', {
    p_cuenta: cuentaId,
    p_wa_id: msj.waId,
    p_perfil: msj.perfilNombre,
  })
  if (eConv) throw new Error(`No se pudo abrir la conversación: ${eConv.message}`)
  const conversacion = Array.isArray(conv) ? conv[0] : conv

  // ── El ECO de un mensaje que alguien mandó desde la app del teléfono: se
  //    guarda en la conversación —es lo que el supervisor va a leer— pero NO
  //    abre la ventana de 24 h y NO mueve la máquina. Lo escribió la empresa,
  //    no la persona.
  if (msj.eco) {
    await supabase.from('crm_mensajes').insert({
      conversacion_id: conversacion.id,
      cuenta_id: cuentaId,
      direccion: 'SALIENTE',
      wamid: msj.wamid,
      tipo: tipoMensaje(msj.clase),
      texto: msj.texto,
      payload: { eco: true, origen: 'APP_DEL_TELEFONO' },
      estado: 'ENVIADO',
      iniciado_por: 'AGENTE',
      enviado_at: msj.momento,
      evento_id: fila.id,
    })
    await supabase.rpc('whatsapp_evento_cerrar', {
      p_evento: fila.id,
      p_estado: 'PROCESADO',
      p_conversacion: conversacion.id,
    })
    return { encolados: 0, descartado: false }
  }

  // ── Un evento MÁS VIEJO que el estado actual de la visita no retrocede la
  //    máquina: se guarda DESCARTADO con el motivo. Los reintentos de Meta
  //    pueden llegar desordenados.
  if (
    fila.timestamp_meta &&
    conversacion.estado_desde &&
    Date.parse(fila.timestamp_meta) < Date.parse(conversacion.estado_desde) - 60_000
  ) {
    await supabase.rpc('whatsapp_registrar_entrante', {
      p_conversacion: conversacion.id,
      p_wamid: msj.wamid,
      p_tipo: tipoMensaje(msj.clase),
      p_texto: msj.texto,
      p_payload: msj.payload as any,
      p_evento: fila.id,
      p_momento: msj.momento,
    })
    await supabase.rpc('whatsapp_evento_cerrar', {
      p_evento: fila.id,
      p_estado: 'DESCARTADO',
      p_motivo: 'El evento es más viejo que el estado actual de la conversación: no se retrocede la máquina.',
      p_conversacion: conversacion.id,
    })
    return { encolados: 0, descartado: true }
  }

  // El entrante se guarda SIEMPRE y antes de todo: es lo que abre la ventana de
  // 24 horas, y si la máquina falla el mensaje de la persona no se pierde.
  const { data: entrante } = await supabase.rpc('whatsapp_registrar_entrante', {
    p_conversacion: conversacion.id,
    p_wamid: msj.wamid,
    p_tipo: tipoMensaje(msj.clase),
    p_texto: msj.texto,
    p_payload: msj.payload as any,
    p_evento: fila.id,
    p_momento: msj.momento,
  })
  const filaEntrante = Array.isArray(entrante) ? entrante[0] : entrante

  const eventoMaquina: EventoMaquina = {
    clase: msj.clase,
    texto: msj.texto,
    idRespuesta: msj.idRespuesta,
    lat: msj.lat,
    lng: msj.lng,
    nombreUbicacion: msj.nombreUbicacion,
    direccionUbicacion: msj.direccionUbicacion,
    mediaId: msj.mediaId,
    mime: msj.mime,
    sha256Declarado: msj.sha256Declarado,
    voz: msj.voz,
    comoDocumento: msj.comoDocumento,
    nombreArchivo: msj.nombreArchivo,
    wamid: msj.wamid,
    momento: msj.momento,
  }

  const encolados = await correrMaquina(supabase, conversacion, eventoMaquina, {
    mensajeEntranteId: filaEntrante?.id ?? null,
  })

  await supabase.rpc('whatsapp_evento_cerrar', {
    p_evento: fila.id,
    p_estado: 'PROCESADO',
    p_conversacion: conversacion.id,
  })
  return { encolados, descartado: false }
}

async function cuentaPorPhoneId(supabase: Sb, phoneId: string | null): Promise<string | null> {
  if (phoneId) {
    const { data } = await supabase
      .from('whatsapp_cuentas')
      .select('id')
      .eq('phone_number_id', phoneId)
      .maybeSingle()
    if (data?.id) return data.id
  }
  // Sin phone_number_id (o uno que no conocemos): la cuenta predeterminada. Es
  // lo que hace funcionar el simulador, que no tiene número.
  const { data } = await supabase
    .from('whatsapp_cuentas')
    .select('id')
    .eq('predeterminada', true)
    .maybeSingle()
  return data?.id ?? null
}

/* ───────────────────────── El contexto de la máquina ──────────────────────── */

async function armarContexto(
  supabase: Sb,
  conv: any,
  evento: EventoMaquina,
): Promise<ContextoMaquina> {
  const c = config()
  const momento = evento.momento ?? new Date().toISOString()

  const [consiente, jornada, ventana] = await Promise.all([
    leerConsentimientos(supabase, conv.persona_id),
    conv.persona_id
      ? supabase.rpc('whatsapp_jornada', {
          p_persona: conv.persona_id,
          p_grupo: conv.grupo_id,
          p_momento: momento,
          p_desde: c.jornadaDesde,
          p_hasta: c.jornadaHasta,
          p_zona: c.zonaHoraria,
        })
      : Promise.resolve({ data: { dentro: false, fuente: 'SIN_PERSONA' } }),
    supabase.rpc('whatsapp_ventana_abierta', {
      p_conversacion: conv.id,
      p_margen_horas: c.ventanaSeguridadHoras,
      p_momento: momento,
    }),
  ])

  const ctx: ContextoMaquina = {
    identificada: !!conv.persona_id,
    personaNombreCorto: null,
    bloqueada: conv.bloqueada === true,
    jornadaAbierta: (jornada as any)?.data?.dentro === true,
    ventanaAbierta: (ventana as any)?.data === true,
    consiente,
    intentos: Number(conv.intentos ?? 0),
    punto: null,
    visitaId: conv.visita_id ?? null,
    visitaNumero: null,
    tareas: [],
    tareaActual: null,
    puntosDelDia: [],
    geocerca: null,
    puntoBuscado: null,
    visitaAbiertaEnOtroPunto: null,
    puedeCrearQr: false,
    fotos: 0,
    notasVoz: 0,
    inicioVisita: null,
    transcripcion: null,
    datos: (conv.contexto ?? {}) as Record<string, unknown>,
  }

  if (!conv.persona_id) return ctx

  // Puntos del día: resuelto EN SQL y limitado a 10, que es lo que una lista de
  // WhatsApp admite EN TOTAL.
  const { data: puntos } = await supabase.rpc('whatsapp_puntos_del_dia', {
    p_persona: conv.persona_id,
    p_momento: momento,
    p_zona: c.zonaHoraria,
    p_limite: 10,
  })
  ctx.puntosDelDia = ((puntos ?? []) as any[]).map((p) => ({
    codigo: p.codigo,
    nombre: p.nombre,
    sedeNombre: p.sede_nombre ?? '',
    estado: p.estado,
  }))

  // El permiso de crear un QR: la clave es PLANA (`gestionar_qr_ronda`), y se
  // resuelve contra la cuenta de la persona si la tiene. Quien no tiene cuenta
  // no tiene permisos: no es un castigo, es que no hay dónde mirarlos.
  ctx.puedeCrearQr = await puedeCrearQr(supabase, conv.persona_id)

  const { data: persona } = await supabase
    .from('personas')
    .select('nombres')
    .eq('id', conv.persona_id)
    .maybeSingle()
  // Solo el primer nombre: en un log (y en este repositorio, que es público) no
  // va el nombre completo de nadie.
  ctx.personaNombreCorto = (persona?.nombres ?? '').split(/\s+/)[0] || null

  // El punto, si la conversación ya tiene uno.
  if (conv.punto_id) ctx.punto = await leerPunto(supabase, { id: conv.punto_id })

  // Un código escrito a mano: se busca aquí, porque la máquina no toca la base.
  if (evento.clase === 'TEXTO' && evento.texto) {
    const { codigoDePunto } = await import('./comandos')
    const cod = codigoDePunto(evento.texto)
    if (cod) {
      const punto = await leerPunto(supabase, { codigo: cod })
      const sedePersona = await sedeDe(supabase, conv.persona_id)
      ctx.puntoBuscado = punto
        ? { existe: true, mismaSede: !sedePersona || punto.sedeId === sedePersona, punto }
        : { existe: false, mismaSede: false, punto: null }
      // ¿Hay otra visita abierta en otro punto?
      const { data: abierta } = await supabase
        .from('ronda_visitas')
        .select('id, punto_id, ronda_puntos ( codigo )')
        .eq('persona_id', conv.persona_id)
        .in('estado', ['ABIERTA', 'EN_CURSO'])
        .order('inicio_servidor', { ascending: false })
        .limit(1)
      const v = ((abierta ?? []) as any[])[0]
      if (v && punto && v.punto_id !== punto.id) {
        ctx.visitaAbiertaEnOtroPunto = { codigo: v.ronda_puntos?.codigo ?? '' }
      }
    }
  }

  // La geocerca la evalúa la MISMA función que usa la app propia, para que el
  // número de metros que se le responde a la persona sea el mismo en los tres
  // canales.
  if (evento.clase === 'UBICACION' && evento.lat != null && evento.lng != null && ctx.punto) {
    const { data: geo } = await supabase.rpc('ronda_geocerca_evaluar', {
      p_punto: ctx.punto.id,
      p_lat: evento.lat,
      p_lng: evento.lng,
      // El webhook de ubicación NO trae precisión del GPS: se manda NULL, que es
      // la verdad, en vez de inventar un número.
      p_precision: null,
    })
    if (geo) {
      ctx.geocerca = {
        distanciaM: Number((geo as any).distancia_m ?? 0),
        dentro: (geo as any).dentro === true,
        radioM: Number((geo as any).radio_m ?? 30),
      }
    }
  }

  // La visita en curso: tareas, fotos y hora de inicio.
  if (conv.visita_id) {
    const { data: visita } = await supabase
      .from('ronda_visitas')
      .select('id, numero, plantilla_id, inicio_servidor, distancia_metros, dentro_geocerca')
      .eq('id', conv.visita_id)
      .maybeSingle()
    if (visita) {
      ctx.visitaNumero = visita.numero
      ctx.inicioVisita = visita.inicio_servidor
      if (ctx.geocerca === null && visita.distancia_metros !== null) {
        ctx.geocerca = {
          distanciaM: Number(visita.distancia_metros),
          dentro: visita.dentro_geocerca === true,
          radioM: ctx.punto?.radioM ?? 30,
        }
      }
      ctx.tareas = await leerTareas(supabase, visita.plantilla_id, visita.id)
      // La duración estimada de la plantilla es la que fija el reloj de la
      // ejecución (el doble, con piso de 45 min y techo de 180).
      const { data: plant } = await supabase
        .from('ronda_plantillas')
        .select('duracion_estimada_min')
        .eq('id', visita.plantilla_id)
        .maybeSingle()
      if (ctx.punto && plant?.duracion_estimada_min) {
        ctx.punto = { ...ctx.punto, duracionMin: Number(plant.duracion_estimada_min) }
      }
      const { count: fotos } = await supabase
        .from('ronda_evidencias')
        .select('id', { count: 'exact', head: true })
        .eq('visita_id', visita.id)
        .eq('tipo', 'FOTO')
      ctx.fotos = fotos ?? 0
      const { count: audios } = await supabase
        .from('whatsapp_medios')
        .select('id', { count: 'exact', head: true })
        .eq('visita_id', visita.id)
        .eq('voz', true)
      ctx.notasVoz = audios ?? 0
    }
  }

  ctx.tareaActual = (ctx.datos.tareaActual as string | null) ?? null
  return ctx
}

async function leerConsentimientos(
  supabase: Sb,
  personaId: string | null,
): Promise<Record<TipoConsentimiento, boolean>> {
  const vacio = { UBICACION: false, FOTOS: false, AUDIO: false, BIOMETRIA: false }
  if (!personaId) return vacio
  // La tabla es append-only y «la última fila manda»: se traen ordenadas y se
  // queda la primera de cada tipo.
  const { data } = await supabase
    .from('persona_consentimientos')
    .select('tipo, otorgado, revocado_at, created_at')
    .eq('persona_id', personaId)
    .order('created_at', { ascending: false })
  const vistos = new Set<string>()
  const r = { ...vacio }
  for (const f of (data ?? []) as any[]) {
    if (vistos.has(f.tipo)) continue
    vistos.add(f.tipo)
    if (f.tipo in r) (r as any)[f.tipo] = f.otorgado === true && !f.revocado_at
  }
  return r
}

async function puedeCrearQr(supabase: Sb, personaId: string): Promise<boolean> {
  const { data: persona } = await supabase
    .from('personas')
    .select('usuario_id')
    .eq('id', personaId)
    .maybeSingle()
  if (!persona?.usuario_id) return false
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('rol, permisos, roles ( permisos )')
    .eq('id', persona.usuario_id)
    .maybeSingle()
  if (!usuario) return false
  if (usuario.rol === 'ADMIN' || usuario.rol === 'SUPER_ADMIN') return true
  const permisos = { ...((usuario as any).roles?.permisos ?? {}), ...(usuario.permisos ?? {}) }
  return permisos.gestionar_qr_ronda === true || permisos.gestionar_puntos_ronda === true
}

async function sedeDe(supabase: Sb, personaId: string): Promise<string | null> {
  const { data } = await supabase.from('personas').select('sede_id').eq('id', personaId).maybeSingle()
  return data?.sede_id ?? null
}

interface PuntoLeido {
  id: string
  codigo: string
  nombre: string
  sedeNombre: string
  sedeId: string
  grupoId: string
  radioM: number
  exigeGeocerca: boolean
  duracionMin: number | null
}

async function leerPunto(
  supabase: Sb,
  por: { id?: string; codigo?: string },
): Promise<PuntoLeido | null> {
  let q = supabase
    .from('ronda_puntos')
    .select('id, codigo, nombre, sede_id, grupo_id, sede_nombre, geocerca_metros, exige_geocerca, estado, sedes ( nombre )')
  q = por.id ? q.eq('id', por.id) : q.eq('codigo', por.codigo)
  const { data } = await q.maybeSingle()
  if (!data || data.estado === 'RETIRADO') return null
  return {
    id: data.id,
    codigo: data.codigo,
    nombre: data.nombre,
    sedeNombre: (data as any).sedes?.nombre ?? data.sede_nombre ?? '',
    sedeId: data.sede_id,
    grupoId: data.grupo_id,
    radioM: Number(data.geocerca_metros ?? 30),
    exigeGeocerca: data.exige_geocerca !== false,
    duracionMin: null,
  }
}

/** Los pasos de la plantilla de la visita, con su estado real según lo ya
 *  contestado. La lista de WhatsApp admite 10 filas EN TOTAL y una se reserva
 *  para paginar, así que lo que importa es el ORDEN, no el tope. */
async function leerTareas(supabase: Sb, plantillaId: string, visitaId: string): Promise<TareaCtx[]> {
  const { data: pasos } = await supabase
    .from('ronda_plantilla_pasos')
    .select('id, orden, tipo, titulo, ayuda, obligatorio, instructivo_id, ronda_instructivos ( texto )')
    .eq('plantilla_id', plantillaId)
    .order('orden')

  const { data: resp } = await supabase
    .from('ronda_respuestas')
    .select('paso_id, omitido, omision_motivo, valor_bool, motivo')
    .eq('visita_id', visitaId)

  const contestados = new Map<string, { omitido: boolean; no: boolean; motivo: string | null }>(
    ((resp ?? []) as any[]).map((r) => [
      r.paso_id,
      {
        omitido: r.omitido === true,
        // Una casilla contestada NO es una tarea que NO SE HIZO, aunque la
        // respuesta exista. Tratarla como hecha haría que el reporte dijera que
        // se hizo algo que no se hizo.
        no: r.valor_bool === false,
        motivo: r.motivo ?? r.omision_motivo ?? null,
      },
    ]),
  )

  return ((pasos ?? []) as any[]).map((p) => {
    const c = contestados.get(p.id)
    return {
      id: p.id,
      titulo: p.titulo,
      descripcion: p.ayuda ?? null,
      tipo: p.tipo,
      estado: !c ? 'PENDIENTE' : c.omitido || c.no ? 'NO_REALIZADA' : 'HECHA',
      motivo: c?.motivo ?? null,
      instructivo: (p as any).ronda_instructivos?.texto ?? null,
      exigeFoto: p.tipo === 'FOTO',
    }
  })
}

/* ─────────────────────────── Correr y ejecutar ────────────────────────────── */

export async function correrMaquina(
  supabase: Sb,
  conv: any,
  evento: EventoMaquina,
  extra: { mensajeEntranteId?: string | null } = {},
): Promise<number> {
  const ctx = await armarContexto(supabase, conv, evento)
  const r = avanzar(conv.estado as EstadoConversacion, evento, ctx)

  // Las acciones PRIMERO y los mensajes DESPUÉS: abrir la visita antes de
  // mandar «mandame la ubicación» evita que la respuesta llegue a una
  // conversación que todavía no tiene visita.
  let visitaId: string | null = ctx.visitaId ?? null
  let puntoId: string | null = conv.punto_id ?? null
  let encolados = 0

  for (const accion of r.acciones) {
    if (accion.tipo === 'MENSAJE') continue
    const hecho = await ejecutar(supabase, accion, { conv, ctx, evento, visitaId, puntoId })
    if (hecho.visitaId) visitaId = hecho.visitaId
    if (hecho.puntoId) puntoId = hecho.puntoId
  }

  // El estado se guarda ANTES de encolar los mensajes, para que el portero
  // evalúe contra el estado nuevo.
  const espera = r.esperaSegundos
  const { data: actualizada, error: eEstado } = await supabase.rpc('crm_conversacion_avanzar', {
    p_conversacion: conv.id,
    p_estado: r.estado,
    p_disparador: r.disparador,
    p_contexto: { ...r.datos, resumenTexto: r.datos.resumenTexto ?? null },
    p_espera_vence: espera === null ? null : new Date(Date.now() + espera * 1000).toISOString(),
    p_visita: visitaId,
    p_punto: puntoId,
    p_intentos: r.intentos,
    p_wamid: evento.wamid ?? null,
  })
  // Si el estado no se pudo guardar, SE LANZA. Seguir sería lo peor posible: la
  // conversación se quedaría en el estado viejo y la próxima vuelta repetiría la
  // misma pregunta para siempre, mientras alguien espera en un punto. El evento
  // vuelve a la cola con su retroceso y queda el error escrito.
  if (eEstado) {
    throw new Error(`No se pudo guardar el estado de la conversación: ${eEstado.message}`)
  }
  const conv2 = (Array.isArray(actualizada) ? actualizada[0] : actualizada) ?? conv

  for (const accion of r.acciones) {
    if (accion.tipo !== 'MENSAJE') continue
    const ok = await encolar(supabase, conv2, accion, visitaId)
    if (ok) encolados++
  }

  // El texto exacto del resumen que la persona vio se guarda aparte: es la
  // prueba de qué leyó antes de confirmar.
  if (r.datos.resumenTexto) {
    await supabase.from('ronda_eventos').insert({
      grupo_id: conv2.grupo_id,
      sede_id: conv2.sede_id,
      entidad: 'crm_conversaciones',
      entidad_id: conv2.id,
      accion: 'RESUMEN_ENVIADO',
      actor_tipo: 'BOT',
      actor_persona_id: conv2.persona_id,
      canal: 'WHATSAPP',
      detalle: { texto: r.datos.resumenTexto, visita_id: visitaId },
    })
  }

  void extra
  return encolados
}

async function encolar(supabase: Sb, conv: any, accion: Extract<Accion, { tipo: 'MENSAJE' }>, visitaId: string | null) {
  const c = config()
  const { mensaje } = accion
  const { error } = await supabase.rpc('whatsapp_encolar', {
    p_conversacion: conv.id,
    p_tipo: mensaje.tipo,
    // `texto` es solo para leer la conversación en la consola; lo que se manda
    // es el payload, que es el mensaje completo con sus botones y sus límites.
    p_texto: 'texto' in mensaje ? mensaje.texto : 'cuerpo' in mensaje ? mensaje.cuerpo : null,
    p_payload: mensaje as any,
    p_iniciado_por: accion.iniciadoPor,
    p_plantilla: accion.plantilla ?? null,
    p_variables: accion.variables ?? null,
    p_consentimiento: accion.consentimiento ?? null,
    p_prioridad: accion.prioridad ?? 1,
    p_visita: visitaId,
    p_jornada_desde: c.jornadaDesde,
    p_jornada_hasta: c.jornadaHasta,
    p_margen_horas: c.ventanaSeguridadHoras,
    p_zona: c.zonaHoraria,
  })
  if (error) {
    // No se lanza: un mensaje que no se pudo encolar no debe perder el evento
    // entrante ni el estado, que ya se guardaron.
    console.error('[whatsapp/encolar]', error.message)
    return false
  }
  return true
}

interface Entorno {
  conv: any
  ctx: ContextoMaquina
  evento: EventoMaquina
  visitaId: string | null
  puntoId: string | null
}

async function ejecutar(
  supabase: Sb,
  accion: Accion,
  e: Entorno,
): Promise<{ visitaId?: string | null; puntoId?: string | null }> {
  const { conv, ctx, evento } = e

  switch (accion.tipo) {
    case 'IDENTIFICAR': {
      // El documento se compara contra el registro de personal. Si no cuadra NO
      // se dice qué documentos sí existen: eso sería una forma de averiguar la
      // nómina preguntándole al bot.
      const { data: persona } = await supabase
        .from('personas')
        .select('id, nombres, sede_id, estado')
        .eq('documento', accion.documento)
        .maybeSingle()
      if (!persona || ['RETIRADO', 'INACTIVO'].includes(String(persona.estado).toUpperCase())) {
        return {}
      }
      // ¿Ya hay otro número vinculado? Entonces hace falta un segundo factor y
      // no se vincula con solo el documento: eso dejaría que cualquiera se
      // adueñe de la cuenta de otro.
      const { data: otros } = await supabase
        .from('persona_canales')
        .select('id, wa_id')
        .eq('persona_id', persona.id)
        .eq('canal', 'WHATSAPP')
        .eq('verificado', true)
      const yaTiene = ((otros ?? []) as any[]).filter((x) => x.wa_id && x.wa_id !== conv.wa_id)
      if (yaTiene.length) {
        await supabase.from('ronda_eventos').insert({
          entidad: 'crm_conversaciones',
          entidad_id: conv.id,
          accion: 'VINCULACION_EXIGE_SEGUNDO_FACTOR',
          actor_tipo: 'BOT',
          canal: 'WHATSAPP',
          detalle: { wa_id: conv.wa_id, persona_id: persona.id },
        })
        return {}
      }
      const { data: sede } = await supabase.from('sedes').select('grupo_id').eq('id', persona.sede_id).maybeSingle()
      await supabase.from('persona_canales').upsert(
        {
          persona_id: persona.id,
          canal: 'WHATSAPP',
          valor: `+${conv.wa_id}`,
          wa_id: conv.wa_id,
          verificado: true,
          verificado_at: new Date().toISOString(),
          verificacion_metodo: 'OTP',
          principal: true,
        },
        { onConflict: 'canal,valor' },
      )
      await supabase
        .from('crm_conversaciones')
        .update({ persona_id: persona.id, sede_id: persona.sede_id, grupo_id: sede?.grupo_id ?? null })
        .eq('id', conv.id)
      conv.persona_id = persona.id
      return {}
    }

    case 'CONSENTIMIENTO': {
      if (!conv.persona_id) return {}
      const c = CONSENTIMIENTOS[accion.tipoDato]
      const { createHash } = await import('node:crypto')
      const { error } = await supabase.rpc('persona_consentimiento_registrar', {
        p_persona: conv.persona_id,
        p_tipo: accion.tipoDato,
        p_otorgado: accion.otorgado,
        p_version: c.version,
        // El hash del TEXTO exacto que la persona leyó. Un «sí» sin el texto no
        // prueba nada (Ley 1581 de 2012).
        p_hash: createHash('sha256').update(c.texto, 'utf8').digest('hex'),
        p_canal: 'WHATSAPP',
      })
      // Si no se pudo registrar, SE LANZA: seguir dejaría a la conversación
      // pidiendo el mismo permiso una y otra vez, y es exactamente lo que no se
      // puede hacer con un consentimiento.
      if (error) throw new Error(`No se pudo registrar el consentimiento: ${error.message}`)
      return {}
    }

    case 'ABRIR_VISITA': {
      // Se vuelve a leer el punto para tener su contrato y su sede: el que vive
      // en el contexto de la máquina es la versión recortada que ella necesita.
      const punto = await leerPunto(supabase, { codigo: accion.puntoCodigo })
      if (!punto) return {}
      // QUÉ tarea se va a hacer: la RPC lo exige, y con razón. Se resuelve con
      // la MISMA función que usa la PWA (`ronda_tareas_punto`), así que el bot
      // ejecuta la versión PUBLICADA que le corresponde al contrato, no una que
      // el bot haya elegido por su cuenta.
      const { data: aplicables } = await supabase.rpc('ronda_tareas_punto', { p_punto: punto.id })
      const tareas = (aplicables ?? []) as { plantilla_id: string; asignacion_id: string | null; duracion_estimada_min: number | null }[]
      if (!tareas.length) {
        await supabase.from('ronda_eventos').insert({
          grupo_id: punto.grupoId,
          sede_id: punto.sedeId,
          entidad: 'crm_conversaciones',
          entidad_id: conv.id,
          accion: 'PUNTO_SIN_TAREAS',
          actor_tipo: 'BOT',
          actor_persona_id: conv.persona_id,
          canal: 'WHATSAPP',
          detalle: { punto: punto.codigo },
        })
        return {}
      }
      const elegida = tareas[0]
      // El id lo genera quien llama: es la llave de idempotencia de la RPC, la
      // misma que usa la cola offline de la app.
      const id = randomUUID()
      const { data, error } = await supabase.rpc('ronda_registrar_visita', {
        p_visita: id,
        p_punto: punto.id,
        p_plantilla: elegida.plantilla_id,
        p_asignacion: elegida.asignacion_id,
        p_apertura_modo: accion.origen === 'QR' ? 'QR' : 'MANUAL',
        p_canal: 'WHATSAPP',
        p_persona: conv.persona_id,
      })
      if (error) {
        await supabase.from('ronda_eventos').insert({
          entidad: 'crm_conversaciones',
          entidad_id: conv.id,
          accion: 'VISITA_NO_SE_PUDO_ABRIR',
          actor_tipo: 'BOT',
          canal: 'WHATSAPP',
          detalle: { motivo: error.message, punto: punto.codigo },
        })
        return {}
      }
      const fila = Array.isArray(data) ? data[0] : data
      return { visitaId: fila?.id ?? id, puntoId: punto.id }
    }

    case 'REGISTRAR_UBICACION': {
      // La ubicación del HITO DE INICIO va también a la visita, no solo al
      // evento: es de donde el reporte y el resumen sacan «a cuántos metros del
      // punto estaba». La RPC de apertura no la pudo poner porque en WhatsApp
      // la visita se abre ANTES de que llegue la ubicación (la solicitud es un
      // mensaje aparte, §4.1 del ADR-01), así que se completa acá.
      if (accion.hito === 'INICIO' && e.visitaId) {
        const fuera = ctx.geocerca ? !ctx.geocerca.dentro : false
        const { error } = await supabase
          .from('ronda_visitas')
          .update({
            lat: accion.lat,
            lng: accion.lng,
            // El webhook de ubicación NO trae precisión del GPS: NULL es la
            // verdad, y un número inventado aquí sería una señal falsa para el
            // antifraude del adr-02.
            precision_metros: null,
            distancia_metros: ctx.geocerca?.distanciaM ?? null,
            dentro_geocerca: ctx.geocerca ? ctx.geocerca.dentro : null,
            // El CHECK de F4 exige el motivo cuando la visita queda marcada
            // fuera de la cerca, y tiene razón: una visita fuera de cerca sin
            // explicación no se puede auditar.
            motivo_fuera_geocerca: fuera
              ? accion.forzada === true
                ? `La persona declaró estar en el punto a ${Math.round(ctx.geocerca?.distanciaM ?? 0)} m (WhatsApp).`
                : `Ubicación recibida por WhatsApp a ${Math.round(ctx.geocerca?.distanciaM ?? 0)} m del punto.`
              : null,
          })
          .eq('id', e.visitaId)
        if (error) console.error('[whatsapp/ubicacion_visita]', error.message)
      }
      await supabase.from('ronda_eventos').insert({
        grupo_id: conv.grupo_id,
        sede_id: conv.sede_id,
        entidad: 'ronda_visitas',
        entidad_id: e.visitaId,
        accion: `UBICACION_${accion.hito}`,
        actor_tipo: 'BOT',
        actor_persona_id: conv.persona_id,
        canal: 'WHATSAPP',
        detalle: {
          lat: accion.lat,
          lng: accion.lng,
          nombre: accion.nombre,
          direccion: accion.direccion,
          // Se dice explícitamente que no hay precisión: el webhook de ubicación
          // no la trae, y dejar el campo en silencio haría pensar que sí.
          precision_metros: null,
          sin_precision_gps: true,
          distancia_m: ctx.geocerca?.distanciaM ?? null,
          dentro: ctx.geocerca?.dentro ?? null,
          forzada: accion.forzada === true,
          context_wamid: evento.wamid ?? null,
        },
      })
      return {}
    }

    case 'GUARDAR_MEDIO':
      await descargarMedio(supabase, {
        conversacionId: conv.id,
        cuentaId: conv.cuenta_id,
        mensajeWamid: evento.wamid ?? null,
        mediaId: accion.mediaId,
        mime: accion.mime ?? null,
        sha256Declarado: accion.sha256Declarado ?? null,
        hito: accion.hito,
        comoDocumento: accion.comoDocumento === true,
        voz: accion.voz === true,
        visitaId: e.visitaId,
        tareaId: accion.tareaId ?? null,
      })
      return {}

    case 'RESPONDER_PASO': {
      if (!e.visitaId) return {}
      const { error } = await supabase.rpc('ronda_responder_paso', {
        p_visita: e.visitaId,
        p_paso: accion.pasoId,
        p_id: randomUUID(),
        p_valor: accion.valor as any,
        p_motivo: accion.motivo ?? null,
        p_omitido: accion.omitido === true,
        p_omision: accion.omitido === true ? (accion.motivo ?? 'Sin motivo') : null,
        p_persona: conv.persona_id,
      })
      if (error) console.error('[whatsapp/responder_paso]', error.message)
      return {}
    }

    case 'CERRAR_VISITA': {
      if (!e.visitaId) return {}
      const { error } = await supabase.rpc('ronda_cerrar_visita', {
        p_visita: e.visitaId,
        p_observacion: accion.borrador
          ? 'Cerrada por el bot de WhatsApp sin confirmación del trabajador: queda como borrador para revisión.'
          : 'Cerrada por la persona desde WhatsApp.',
        p_motivo_incompleta: accion.motivoIncompleta ?? null,
        p_persona: conv.persona_id,
      })
      if (error) {
        // El cierre falló: la confirmación NO se pierde. La conversación se
        // queda en CONFIRMADA, el temporizador lo reintenta y queda el rastro.
        await supabase.from('ronda_eventos').insert({
          entidad: 'ronda_visitas',
          entidad_id: e.visitaId,
          accion: 'CIERRE_FALLIDO',
          actor_tipo: 'BOT',
          canal: 'WHATSAPP',
          detalle: { motivo: error.message },
        })
      }
      return {}
    }

    case 'ANULAR_VISITA': {
      if (!e.visitaId) return {}
      const { error } = await supabase.rpc('ronda_anular_visita', {
        p_visita: e.visitaId,
        p_motivo: accion.motivo,
      })
      if (error) console.error('[whatsapp/anular]', error.message)
      return {}
    }

    case 'NOVEDAD': {
      if (!e.visitaId) {
        // Una novedad SIN visita (el comando NOVEDAD suelto) todavía no tiene
        // RPC propia: F4 cuelga `ronda_reportar_novedad` de una visita. Se deja
        // el rastro y queda anotado como pendiente en el informe.
        await supabase.from('ronda_eventos').insert({
          grupo_id: conv.grupo_id,
          sede_id: conv.sede_id,
          entidad: 'crm_conversaciones',
          entidad_id: conv.id,
          accion: 'NOVEDAD_SIN_VISITA',
          actor_tipo: 'BOT',
          actor_persona_id: conv.persona_id,
          canal: 'WHATSAPP',
          detalle: { titulo: accion.titulo, descripcion: accion.descripcion ?? null },
        })
        return {}
      }
      const { error } = await supabase.rpc('ronda_reportar_novedad', {
        p_id: randomUUID(),
        p_visita: e.visitaId,
        p_clase: accion.clase ?? 'MANTENIMIENTO',
        p_titulo: accion.titulo,
        p_descripcion: accion.descripcion ?? null,
        p_persona: conv.persona_id,
      })
      if (error) console.error('[whatsapp/novedad]', error.message)
      return {}
    }

    case 'DERIVAR_AGENTE':
    case 'AVISAR_SUPERVISOR':
      // Queda en la auditoría del módulo, que es la bandeja que mira
      // supervisión desde la consola. El CRM con casos, etiquetas y asignación
      // es F11: cuando exista, esto abre un caso en vez de un evento.
      await supabase.from('ronda_eventos').insert({
        grupo_id: conv.grupo_id,
        sede_id: conv.sede_id,
        entidad: 'crm_conversaciones',
        entidad_id: conv.id,
        accion: accion.tipo === 'DERIVAR_AGENTE' ? 'DERIVADO_A_AGENTE' : 'AVISO_A_SUPERVISOR',
        actor_tipo: 'BOT',
        actor_persona_id: conv.persona_id,
        canal: 'WHATSAPP',
        detalle: {
          motivo: accion.motivo,
          ...(accion.tipo === 'AVISAR_SUPERVISOR' ? { detalle: accion.detalle ?? null } : {}),
          visita_id: e.visitaId,
        },
      })
      return {}

    case 'TRANSCRIBIR':
      // La transcripción corre después, con el archivo ya en Storage: depende de
      // un tercero y no puede trancar el turno del trabajador. El audio original
      // NUNCA se borra: la transcripción es una conveniencia, la prueba es el
      // archivo.
      await supabase
        .from('whatsapp_medios')
        .update({ estado: 'PENDIENTE' })
        .eq('media_id', accion.mediaId)
        .eq('conversacion_id', conv.id)
      return {}

    case 'RECARGAR_TAREAS':
      return {}

    default:
      return {}
  }
}

/* ────────────────────────────── Vencimientos ──────────────────────────────── */

export interface ResultadoVencimientos {
  revisadas: number
  movidas: number
  mensajesEncolados: number
}

/** Los temporizadores de la §4 y el cierre de jornada de la §7. Lo llama el
 *  cron de cada minuto, porque los relojes de la máquina son de minutos. */
export async function procesarVencimientos(
  supabase: Sb,
  limite = 100,
): Promise<ResultadoVencimientos> {
  const res: ResultadoVencimientos = { revisadas: 0, movidas: 0, mensajesEncolados: 0 }
  const c = config()

  const { data, error } = await supabase.rpc('whatsapp_vencidos', { p_limite: limite })
  if (error) throw new Error(`No se pudieron leer los vencimientos: ${error.message}`)

  for (const conv of (data ?? []) as any[]) {
    res.revisadas++
    const momento = new Date().toISOString()

    // Primero la jornada: si ya terminó el turno, el evento es FIN_JORNADA y no
    // un temporizador más. Es una obligación legal, no una preferencia.
    let clase: EventoMaquina['clase'] = 'TEMPORIZADOR'
    if (conv.persona_id) {
      const { data: jor } = await supabase.rpc('whatsapp_jornada', {
        p_persona: conv.persona_id,
        p_grupo: conv.grupo_id,
        p_momento: momento,
        p_desde: c.jornadaDesde,
        p_hasta: c.jornadaHasta,
        p_zona: c.zonaHoraria,
      })
      if ((jor as any)?.dentro === false && conv.estado !== 'EN_ESPERA_FUERA_DE_JORNADA') {
        clase = 'FIN_JORNADA'
      }
    }

    try {
      res.mensajesEncolados += await correrMaquina(supabase, conv, { clase, momento })
      res.movidas++
    } catch (err) {
      console.error('[whatsapp/vencimientos]', conv.id, err instanceof Error ? err.message : err)
    }
  }
  return res
}
