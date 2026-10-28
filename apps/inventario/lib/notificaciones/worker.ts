import 'server-only'
import { renderPlantilla, renderTexto, htmlATexto, type Payload } from '@/lib/email/plantillas'
import { separarCorreos, unirDestinos, type DestinoCorreo } from './correos'

/**
 * Worker del motor de flujos de notificación.
 *
 * `emitir_evento` (SQL) programa los pasos de cada flujo que aplica; aquí se
 * ejecutan los que ya vencieron:
 *
 *   · Antes de ejecutar, si el paso tiene VERIFICACIÓN se relee el registro en
 *     la base de datos. Así funcionan los escalamientos del tipo "si a las 24 h
 *     la orden sigue PENDIENTE, avisa al coordinador": si ya no sigue, el paso
 *     se omite (y opcionalmente se cancela el resto del flujo).
 *   · EMAIL   → encola en `correo_saliente` (lo envía el cron de correo).
 *   · APP     → inserta en `notificaciones` para los usuarios destino.
 *   · ESPERA  → solo marca el tiempo; sirve para separar pasos.
 *   · WEBHOOK → POST con el payload del evento.
 *
 * No lanza: cada paso registra su resultado y el lote continúa.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const MAX_INTENTOS = 3
// Las plantillas pueden enlazar a la plataforma con {{app_url}}.
const APP_URL = (process.env.APP_BASE_URL || 'https://concerjes-inmobiliarios-inventario.vercel.app').replace(/\/+$/, '')

export interface ResultadoWorker {
  ejecutados: number
  omitidos: number
  errores: number
  correos: number
  notificaciones: number
}

interface Destinatarios {
  roles?: string[]
  usuarios?: string[]
  correos?: string[]
  campos?: string[]
  /** Listas del directorio de correos (`directorio_listas.codigo`). */
  listas?: string[]
  /** Entidad que trae el evento con su propio correo (p. ej. el centro médico). */
  entidades?: string[]
}

/**
 * Entidades cuyo correo (y copias) se toma del registro que trae el evento.
 * Lista cerrada: un paso no puede leer cualquier tabla. Si el evento no trae
 * el id (p. ej. "Otra IPS" escrita a mano), se usa el correo del payload.
 */
const ENTIDADES: Record<string, { tabla: string; campoId: string; campoCorreo: string }> = {
  ips: { tabla: 'ips', campoId: 'ips_id', campoCorreo: 'ips_correo' },
}

interface Verificacion {
  tabla?: string
  columna_id?: string
  campo_payload?: string
  campo?: string
  operador?: string
  valor?: string
}

interface PasoFlujo {
  id: string
  flujo_id: string
  orden: number
  nombre: string | null
  // WHATSAPP lo agrega F9 (Puntos QR): el canal es un valor más de `tipo` y un
  // caso más en este worker, no un motor aparte. Lo pide la §8.1 punto 6 del
  // complemento 2.
  tipo: 'EMAIL' | 'APP' | 'ESPERA' | 'WEBHOOK' | 'WHATSAPP'
  demora_minutos: number
  plantilla_id: string | null
  asunto: string | null
  mensaje: string | null
  destinatarios: Destinatarios | null
  severidad: string
  enlace: string | null
  webhook_url: string | null
  verificacion: Verificacion | null
  detener_si_falla: boolean
  activo: boolean
}

interface PasoPendiente {
  id: string
  ejecucion_id: string
  paso_id: string | null
  orden: number
  intentos: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flujo_ejecuciones: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flujo_pasos: any
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Compara dos valores con el mismo criterio que `comparar_valor` en SQL. */
export function comparar(actual: unknown, operador: string, esperado: string | undefined): boolean {
  if (operador === 'existe') return actual !== null && actual !== undefined && String(actual) !== ''
  if (operador === 'vacio') return actual === null || actual === undefined || String(actual) === ''
  if (actual === null || actual === undefined) return operador === '!='

  const a = String(actual)
  const b = esperado ?? ''
  const na = Number(a)
  const nb = Number(b)
  const numerico = a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)

  switch (operador) {
    case '=':  return numerico ? na === nb : a.toLowerCase() === b.toLowerCase()
    case '!=': return numerico ? na !== nb : a.toLowerCase() !== b.toLowerCase()
    case '>':  return numerico && na > nb
    case '>=': return numerico && na >= nb
    case '<':  return numerico && na < nb
    case '<=': return numerico && na <= nb
    case 'contiene':    return a.toLowerCase().includes(b.toLowerCase())
    case 'no_contiene': return !a.toLowerCase().includes(b.toLowerCase())
    case 'en':          return b.toLowerCase().split(',').map((s) => s.trim()).includes(a.toLowerCase())
    default: return false
  }
}

function valorPayload(payload: Payload, ruta?: string | null): unknown {
  if (!ruta) return undefined
  return ruta.split('.').reduce<unknown>((acc, parte) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[parte]
    return undefined
  }, payload)
}

/**
 * Relee el registro señalado por la verificación y decide si el paso continúa.
 * Sin verificación configurada → siempre continúa.
 */
async function verificar(
  supabase: DB,
  verificacion: Verificacion | null,
  payload: Payload,
  entidadId: string | null,
): Promise<{ continuar: boolean; motivo?: string }> {
  const v = verificacion ?? {}
  if (!v.tabla || !v.campo) return { continuar: true }

  const id = (valorPayload(payload, v.campo_payload) as string | undefined) ?? entidadId
  if (!id) return { continuar: false, motivo: 'La verificación no encontró el identificador del registro.' }

  const { data, error } = await supabase
    .from(v.tabla)
    .select(v.campo)
    .eq(v.columna_id || 'id', id)
    .maybeSingle()

  if (error) return { continuar: false, motivo: `No se pudo verificar ${v.tabla}.${v.campo}: ${error.message}` }
  if (!data) return { continuar: false, motivo: `El registro ya no existe en ${v.tabla}.` }

  const actual = (data as Record<string, unknown>)[v.campo]
  const ok = comparar(actual, v.operador || '=', v.valor)
  return ok
    ? { continuar: true }
    : { continuar: false, motivo: `La condición ya no se cumple: ${v.campo} = "${String(actual)}".` }
}

/**
 * Resuelve los destinatarios de un paso: correos (cada uno con sus copias) y
 * usuarios de la app. Los contactos del directorio y el centro médico del
 * evento se leen al momento de enviar, así que un cambio en el directorio
 * aplica de una vez.
 */
async function resolverDestinatarios(
  supabase: DB,
  dest: Destinatarios | null,
  payload: Payload,
): Promise<{ destinos: DestinoCorreo[]; usuarios: { id: string; email: string | null }[] }> {
  const d = dest ?? {}
  const destinos: DestinoCorreo[] = []
  const usuarios = new Map<string, { id: string; email: string | null }>()
  const agregar = (para: string, copia: string[] = []) => destinos.push({ para, copia })

  for (const c of separarCorreos(d.correos ?? [])) agregar(c)

  // Campos del payload que traen el correo del destinatario (cliente, aspirante…).
  for (const campo of d.campos ?? []) {
    for (const c of separarCorreos(valorPayload(payload, campo))) agregar(c)
  }

  // Listas del directorio de correos: cada contacto recibe su correo con sus copias.
  if ((d.listas ?? []).length > 0) {
    const { data: listas } = await supabase
      .from('directorio_listas').select('codigo').in('codigo', d.listas as string[]).eq('activo', true)
    const activas = ((listas ?? []) as { codigo: string }[]).map((l) => l.codigo)
    if (activas.length > 0) {
      const { data: contactos } = await supabase
        .from('directorio_contactos').select('correo, correos_copia').in('lista_codigo', activas).eq('activo', true)
      for (const c of (contactos ?? []) as { correo: string | null; correos_copia: string[] | null }[]) {
        const [para] = separarCorreos(c.correo)
        if (para) agregar(para, separarCorreos(c.correos_copia))
      }
    }
  }

  // Entidad que trae el evento (p. ej. el centro médico de la remisión).
  for (const nombre of d.entidades ?? []) {
    const e = ENTIDADES[nombre]
    if (!e) continue
    const id = valorPayload(payload, e.campoId)
    let resuelto = false
    if (typeof id === 'string' && id) {
      const { data } = await supabase.from(e.tabla).select('correo, correos_copia').eq('id', id).maybeSingle()
      const [para] = separarCorreos(data?.correo)
      if (para) { agregar(para, separarCorreos(data?.correos_copia)); resuelto = true }
    }
    if (!resuelto) {
      const [para] = separarCorreos(valorPayload(payload, e.campoCorreo))
      if (para) agregar(para)
    }
  }

  if ((d.roles ?? []).length > 0) {
    const { data } = await supabase
      .from('usuarios').select('id, email')
      .eq('activo', true).in('rol', d.roles as string[])
    for (const u of (data ?? []) as { id: string; email: string | null }[]) {
      usuarios.set(u.id, u)
      if (u.email && RE_EMAIL.test(u.email)) agregar(u.email)
    }
  }

  if ((d.usuarios ?? []).length > 0) {
    const { data } = await supabase
      .from('usuarios').select('id, email')
      .in('id', d.usuarios as string[])
    for (const u of (data ?? []) as { id: string; email: string | null }[]) {
      usuarios.set(u.id, u)
      if (u.email && RE_EMAIL.test(u.email)) agregar(u.email)
    }
  }

  return { destinos: unirDestinos(destinos), usuarios: [...usuarios.values()] }
}

/** Encola los correos del paso en el buzón de salida. */
async function ejecutarEmail(
  supabase: DB,
  paso: PasoFlujo,
  payload: Payload,
  ejecucionPasoId: string,
  entidadId: string | null,
): Promise<{ enviados: number; detalle: string; omitido?: boolean }> {
  // Sin cuenta de correo no se encola nada: así no salen avisos viejos (una
  // remisión de hace semanas) el día que se conecte la cuenta.
  const { data: hayCuenta, error: errorCuenta } = await supabase.rpc('correo_envio_configurado')
  if (!errorCuenta && hayCuenta === false) {
    return {
      enviados: 0, omitido: true,
      detalle: 'No hay una cuenta de correo conectada (Integraciones → Correo): el correo no se envió.',
    }
  }

  const { destinos } = await resolverDestinatarios(supabase, paso.destinatarios, payload)
  if (destinos.length === 0) return { enviados: 0, detalle: 'Sin destinatarios con correo.' }

  const datos: Payload = { ...payload, app_url: APP_URL }
  let asunto = paso.asunto ? renderTexto(paso.asunto, datos) : ''
  let html = ''
  let texto = ''
  let plantillaCodigo: string | null = null

  if (paso.plantilla_id) {
    const { data: plantilla } = await supabase
      .from('plantillas_correo')
      .select('codigo, asunto, cuerpo_html, cuerpo_texto, activa')
      .eq('id', paso.plantilla_id).maybeSingle()

    if (!plantilla) return { enviados: 0, detalle: 'La plantilla del paso ya no existe.' }
    if (!plantilla.activa) return { enviados: 0, detalle: 'La plantilla del paso está desactivada.' }

    const r = renderPlantilla(plantilla, datos)
    asunto = asunto || r.asunto
    html = r.html
    texto = r.texto
    plantillaCodigo = plantilla.codigo
  } else {
    const cuerpo = renderTexto(paso.mensaje ?? '', datos)
    texto = cuerpo
    html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.6">${cuerpo.replace(/\n/g, '<br>')}</div>`
    asunto = asunto || (paso.nombre ?? 'Notificación · Conserjes Inmobiliarios')
  }

  const enlace = paso.enlace ? renderTexto(paso.enlace, datos) : null

  const filas = destinos.map(({ para, copia }) => ({
    para,
    copia: copia.length > 0 ? copia.join(', ') : null,
    asunto: asunto.slice(0, 300),
    cuerpo_texto: texto || htmlATexto(html),
    cuerpo_html: html,
    enlace,
    origen: 'flujo',
    ref_id: entidadId,
    plantilla_codigo: plantillaCodigo,
    ejecucion_paso_id: ejecucionPasoId,
  }))

  const { error } = await supabase.from('correo_saliente').insert(filas)
  if (error) throw new Error('No se pudieron encolar los correos: ' + error.message)
  return { enviados: filas.length, detalle: `Encolados ${filas.length} correo(s).` }
}

/** Inserta la notificación en la bandeja de los usuarios destino. */
async function ejecutarApp(
  supabase: DB,
  paso: PasoFlujo,
  payload: Payload,
  entidad: string | null,
  entidadId: string | null,
): Promise<{ enviados: number; detalle: string }> {
  const { usuarios } = await resolverDestinatarios(supabase, paso.destinatarios, payload)
  if (usuarios.length === 0) return { enviados: 0, detalle: 'Sin usuarios destino en la plataforma.' }

  const titulo = (paso.asunto ? renderTexto(paso.asunto, payload) : paso.nombre ?? 'Notificación').slice(0, 250)
  const descripcion = renderTexto(paso.mensaje ?? '', payload) || null
  const enlace = paso.enlace ? renderTexto(paso.enlace, payload) : null

  const filas = usuarios.map((u) => ({
    usuario_id: u.id,
    tipo: 'SISTEMA',
    severidad: paso.severidad || 'INFO',
    titulo,
    descripcion,
    entidad,
    entidad_id: entidadId,
    enlace,
    metadata: payload,
  }))

  const { error } = await supabase.from('notificaciones').insert(filas)
  if (error) throw new Error('No se pudo notificar en la app: ' + error.message)
  return { enviados: filas.length, detalle: `Notificados ${filas.length} usuario(s).` }
}

/**
 * Encola un mensaje de WhatsApp por el buzón de salida de F9 (Puntos QR).
 *
 * El canal es un caso más de este worker y no un motor aparte, que es lo que
 * pide la §8.1 punto 6 del complemento 2. Tres reglas propias de WhatsApp que un
 * correo no tiene:
 *
 *   · OPT-IN OBLIGATORIO. Sin `persona_consentimientos` de tipo WHATSAPP la
 *     persona NO entra. No es una preferencia: es lo que exige la §10.3 del
 *     complemento, y un correo de trabajo no necesita permiso pero un WhatsApp
 *     al celular personal sí.
 *   · PLANTILLA. Un flujo se dispara por un evento, en cualquier momento, y es
 *     normal que la ventana de 24 h esté cerrada. Sin `plantilla` el portero lo
 *     va a omitir con OMITIDO_VENTANA, y eso está bien: queda registrado y el
 *     supervisor lo recoge. El nombre de la plantilla va en `paso.asunto`.
 *   · JORNADA. El portero lo bloquea fuera del turno de la persona (Ley 2191).
 *
 * Nada de esto se decide aquí: se encola por `whatsapp_encolar`, que es la
 * ÚNICA puerta de salida y la que tiene el portero.
 */
async function ejecutarWhatsapp(
  supabase: DB,
  paso: PasoFlujo,
  payload: Payload,
): Promise<{ enviados: number; omitido: boolean; detalle: string }> {
  const { usuarios } = await resolverDestinatarios(supabase, paso.destinatarios, payload)
  if (usuarios.length === 0) {
    return { enviados: 0, omitido: true, detalle: 'Sin usuarios destino para WhatsApp.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: cuenta } = await sb
    .from('whatsapp_cuentas')
    .select('id')
    .in('estado', ['ACTIVA', 'SIMULADA'])
    .eq('predeterminada', true)
    .maybeSingle()
  if (!cuenta?.id) {
    return { enviados: 0, omitido: true, detalle: 'No hay una cuenta de WhatsApp conectada.' }
  }

  const { data: personas } = await sb
    .from('personas')
    .select('id, usuario_id')
    .in('usuario_id', usuarios.map((u) => u.id))
  const ids = ((personas ?? []) as { id: string }[]).map((p) => p.id)
  if (ids.length === 0) {
    return { enviados: 0, omitido: true, detalle: 'Ningún usuario destino está vinculado a una persona.' }
  }

  const { data: canales } = await sb
    .from('persona_canales')
    .select('persona_id, wa_id, valor')
    .in('persona_id', ids)
    .eq('canal', 'WHATSAPP')
    .eq('verificado', true)
    .eq('activo', true)
    .is('bloqueado_at', null)

  const texto = renderTexto(paso.mensaje ?? '', payload)
  const plantilla = paso.asunto ? renderTexto(paso.asunto, payload).trim() : null

  let encolados = 0
  let sinOptIn = 0
  for (const c of (canales ?? []) as { persona_id: string; wa_id: string | null; valor: string }[]) {
    // El opt-in se consulta en la base, con la misma función que usa el bot: la
    // última declaración manda.
    const { data: optIn } = await sb.rpc('persona_consiente', {
      p_persona: c.persona_id,
      p_tipo: 'WHATSAPP',
    })
    if (optIn !== true) {
      sinOptIn++
      continue
    }
    const waId = (c.wa_id ?? c.valor).replace(/[^0-9]/g, '')
    if (!waId) continue
    const { data: conv } = await sb.rpc('crm_conversacion_resolver', {
      p_cuenta: cuenta.id,
      p_wa_id: waId,
      p_perfil: null,
    })
    const fila = Array.isArray(conv) ? conv[0] : conv
    if (!fila?.id) continue
    const { error } = await sb.rpc('whatsapp_encolar', {
      p_conversacion: fila.id,
      p_tipo: plantilla ? 'PLANTILLA' : 'TEXTO',
      p_texto: texto || null,
      p_payload: plantilla ? {} : { tipo: 'TEXTO', texto },
      p_iniciado_por: 'BOT',
      p_plantilla: plantilla,
      // Un aviso de flujo no es urgente: va detrás de las respuestas a quien
      // está parado en un punto esperando.
      p_prioridad: 7,
    })
    if (!error) encolados++
  }

  const notas: string[] = [`Encolados ${encolados} mensaje(s) de WhatsApp.`]
  if (sinOptIn) notas.push(`${sinOptIn} sin opt-in de WhatsApp (no se les escribe).`)
  if (!plantilla) notas.push('Sin plantilla: fuera de la ventana de 24 h el portero lo va a omitir.')
  return { enviados: encolados, omitido: encolados === 0, detalle: notas.join(' ') }
}

/** Envía el payload del evento a un webhook externo. */
async function ejecutarWebhook(paso: PasoFlujo, payload: Payload): Promise<string> {
  if (!paso.webhook_url) throw new Error('El paso no tiene URL de webhook.')
  const res = await fetch(renderTexto(paso.webhook_url, payload), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paso: paso.nombre, payload }),
  })
  if (!res.ok) throw new Error(`El webhook respondió HTTP ${res.status}.`)
  return `Webhook OK (HTTP ${res.status}).`
}

/** Cierra la ejecución si ya no le quedan pasos programados. */
async function cerrarSiTermino(supabase: DB, ejecucionId: string): Promise<void> {
  const { count } = await supabase
    .from('flujo_ejecucion_pasos')
    .select('id', { count: 'exact', head: true })
    .eq('ejecucion_id', ejecucionId)
    .eq('estado', 'PROGRAMADO')
  if ((count ?? 0) === 0) {
    await supabase.from('flujo_ejecuciones').update({ estado: 'COMPLETADA' }).eq('id', ejecucionId)
  }
}

/**
 * Ejecuta los pasos de flujo cuyo momento ya llegó.
 * Reutilizable desde el cron (service role) y desde el botón "Ejecutar ahora".
 */
export async function procesarFlujosPendientes(supabase: DB, limite = 50): Promise<ResultadoWorker> {
  const res: ResultadoWorker = { ejecutados: 0, omitidos: 0, errores: 0, correos: 0, notificaciones: 0 }

  const { data: pendientes } = await supabase
    .from('flujo_ejecucion_pasos')
    .select('*, flujo_ejecuciones(*), flujo_pasos(*)')
    .eq('estado', 'PROGRAMADO')
    .lte('programado_para', new Date().toISOString())
    .lt('intentos', MAX_INTENTOS)
    .order('programado_para', { ascending: true })
    .limit(limite)

  const lista = (pendientes ?? []) as PasoPendiente[]
  if (lista.length === 0) return res

  const ejecucionesTocadas = new Set<string>()

  for (const fila of lista) {
    const ejecucion = fila.flujo_ejecuciones
    const paso = fila.flujo_pasos as PasoFlujo | null
    const intentos = (fila.intentos ?? 0) + 1
    ejecucionesTocadas.add(fila.ejecucion_id)

    const marcar = (estado: string, resultado: string, detalle: Record<string, unknown> = {}) =>
      supabase.from('flujo_ejecucion_pasos').update({
        estado, resultado, intentos, detalle,
        ejecutado_at: new Date().toISOString(),
      }).eq('id', fila.id)

    // La ejecución pudo cancelarse desde otro paso o desde la UI.
    if (!ejecucion || ejecucion.estado !== 'EN_CURSO') {
      await marcar('OMITIDO', 'La ejecución del flujo ya no está en curso.')
      res.omitidos++
      continue
    }
    if (!paso || !paso.activo) {
      await marcar('OMITIDO', 'El paso fue eliminado o desactivado.')
      res.omitidos++
      continue
    }

    const payload = (ejecucion.payload ?? {}) as Payload

    try {
      const chequeo = await verificar(supabase, paso.verificacion, payload, ejecucion.entidad_id ?? null)
      if (!chequeo.continuar) {
        await marcar('OMITIDO', chequeo.motivo ?? 'La verificación no se cumple.')
        res.omitidos++
        if (paso.detener_si_falla) {
          await supabase.from('flujo_ejecucion_pasos')
            .update({ estado: 'OMITIDO', resultado: 'Flujo detenido en un paso anterior.' })
            .eq('ejecucion_id', fila.ejecucion_id).eq('estado', 'PROGRAMADO')
          await supabase.from('flujo_ejecuciones')
            .update({ estado: 'CANCELADA' }).eq('id', fila.ejecucion_id)
        }
        continue
      }

      let detalle = ''
      if (paso.tipo === 'EMAIL') {
        const r = await ejecutarEmail(supabase, paso, payload, fila.id, ejecucion.entidad_id ?? null)
        if (r.omitido) {
          await marcar('OMITIDO', r.detalle)
          res.omitidos++
          continue
        }
        res.correos += r.enviados
        detalle = r.detalle
      } else if (paso.tipo === 'APP') {
        const r = await ejecutarApp(supabase, paso, payload, ejecucion.entidad ?? null, ejecucion.entidad_id ?? null)
        res.notificaciones += r.enviados
        detalle = r.detalle
      } else if (paso.tipo === 'WHATSAPP') {
        const r = await ejecutarWhatsapp(supabase, paso, payload)
        if (r.omitido) {
          await marcar('OMITIDO', r.detalle)
          res.omitidos++
          continue
        }
        detalle = r.detalle
      } else if (paso.tipo === 'WEBHOOK') {
        detalle = await ejecutarWebhook(paso, payload)
      } else {
        detalle = 'Espera cumplida.'
      }

      await marcar('EJECUTADO', detalle)
      res.ejecutados++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al ejecutar el paso.'
      // Se reintenta en la siguiente pasada del cron hasta MAX_INTENTOS.
      await supabase.from('flujo_ejecucion_pasos').update({
        estado: intentos >= MAX_INTENTOS ? 'ERROR' : 'PROGRAMADO',
        resultado: msg,
        intentos,
      }).eq('id', fila.id)
      res.errores++
    }
  }

  for (const id of ejecucionesTocadas) await cerrarSiTermino(supabase, id)
  return res
}
