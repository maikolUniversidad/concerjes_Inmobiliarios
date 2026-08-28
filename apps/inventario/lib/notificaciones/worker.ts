import 'server-only'
import { renderPlantilla, renderTexto, htmlATexto, type Payload } from '@/lib/email/plantillas'

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
  tipo: 'EMAIL' | 'APP' | 'ESPERA' | 'WEBHOOK'
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

/** Resuelve los destinatarios de un paso a correos y a usuarios de la app. */
async function resolverDestinatarios(
  supabase: DB,
  dest: Destinatarios | null,
  payload: Payload,
): Promise<{ correos: string[]; usuarios: { id: string; email: string | null }[] }> {
  const d = dest ?? {}
  const correos = new Set<string>()
  const usuarios = new Map<string, { id: string; email: string | null }>()

  for (const c of d.correos ?? []) {
    const email = String(c).trim()
    if (RE_EMAIL.test(email)) correos.add(email.toLowerCase())
  }

  // Campos del payload que traen el correo del destinatario (cliente, aspirante…).
  for (const campo of d.campos ?? []) {
    const v = valorPayload(payload, campo)
    if (typeof v === 'string' && RE_EMAIL.test(v.trim())) correos.add(v.trim().toLowerCase())
  }

  if ((d.roles ?? []).length > 0) {
    const { data } = await supabase
      .from('usuarios').select('id, email')
      .eq('activo', true).in('rol', d.roles as string[])
    for (const u of (data ?? []) as { id: string; email: string | null }[]) {
      usuarios.set(u.id, u)
      if (u.email) correos.add(u.email.toLowerCase())
    }
  }

  if ((d.usuarios ?? []).length > 0) {
    const { data } = await supabase
      .from('usuarios').select('id, email')
      .in('id', d.usuarios as string[])
    for (const u of (data ?? []) as { id: string; email: string | null }[]) {
      usuarios.set(u.id, u)
      if (u.email) correos.add(u.email.toLowerCase())
    }
  }

  return { correos: [...correos], usuarios: [...usuarios.values()] }
}

/** Encola los correos del paso en el buzón de salida. */
async function ejecutarEmail(
  supabase: DB,
  paso: PasoFlujo,
  payload: Payload,
  ejecucionPasoId: string,
  entidadId: string | null,
): Promise<{ enviados: number; detalle: string }> {
  const { correos } = await resolverDestinatarios(supabase, paso.destinatarios, payload)
  if (correos.length === 0) return { enviados: 0, detalle: 'Sin destinatarios con correo.' }

  let asunto = paso.asunto ? renderTexto(paso.asunto, payload) : ''
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

    const r = renderPlantilla(plantilla, payload)
    asunto = asunto || r.asunto
    html = r.html
    texto = r.texto
    plantillaCodigo = plantilla.codigo
  } else {
    const cuerpo = renderTexto(paso.mensaje ?? '', payload)
    texto = cuerpo
    html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.6">${cuerpo.replace(/\n/g, '<br>')}</div>`
    asunto = asunto || (paso.nombre ?? 'Notificación · Conserjes Inmobiliarios')
  }

  const enlace = paso.enlace ? renderTexto(paso.enlace, payload) : null

  const filas = correos.map((para) => ({
    para,
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
        res.correos += r.enviados
        detalle = r.detalle
      } else if (paso.tipo === 'APP') {
        const r = await ejecutarApp(supabase, paso, payload, ejecucion.entidad ?? null, ejecucion.entidad_id ?? null)
        res.notificaciones += r.enviados
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
