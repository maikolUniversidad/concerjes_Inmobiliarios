'use server'

// Escrituras de la bandeja del CRM (F11 de Puntos QR).
//
// TODO ENTRA POR RPC, nunca por un UPDATE desde acá. Las tablas `crm_casos`,
// `crm_sla`, `crm_asignaciones` y `crm_caso_etiquetas` NO tienen política de RLS
// de escritura: la única puerta son las funciones SECURITY DEFINER de la
// migración, y se llaman con la SESIÓN del usuario (no con la llave de
// servicio), así que la base también comprueba el permiso y sabe quién fue.
//
// LA REGLA QUE NO SE NEGOCIA, acá: `analizarCaso()` llama al modelo y GUARDA la
// sugerencia. `aprobarRespuesta()` es lo único que la manda, y para armar el
// envío usa `prepararEnvio()` de lib/crm/aprobacion.ts — no arma el payload a
// mano. Si alguien borra esa llamada, la prueba
// tests/inventario/crm-sin-envio-automatico.test.ts lo caza.
//
// El catálogo (etiquetas y reglas de SLA) sí va por RLS con `parametrizar_crm`:
// es parametrización, no operación, y no hay máquina de estados que proteger.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { prepararEnvio, type CasoParaAprobar } from '@/lib/crm/aprobacion'
import {
  analizarConversacion, faltaParaIa, iaActiva, PROMPT_VERSION,
  type MensajeConversacion,
} from '@/lib/crm/ia'

export interface ActionResult { error?: string; ok?: boolean; id?: string; aviso?: string }

const GESTIONA = 'gestionar_crm'
const PARAMETRIZA = 'parametrizar_crm'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}

/** Traduce lo que devuelve la base a algo que se pueda leer en la pantalla. */
function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese caso no está en tu alcance de contratos.'
  }
  if (msg.includes('ux_crm_casos_abierto')) {
    return 'Esa conversación ya tiene un caso abierto.'
  }
  if (msg.includes('ux_crm_etiquetas_codigo')) {
    return 'Ya hay una etiqueta con ese código en el mismo ámbito.'
  }
  if (msg.includes('ux_crm_sla_reglas_ambito')) {
    return 'Ya hay una regla de SLA para ese contrato, ese tipo y esa prioridad.'
  }
  if (msg.includes('ck_crm_sla_reglas_franja') || msg.includes('ck_crm_sla_franja')) {
    return 'La franja hábil no puede cruzar la medianoche: la hora de cierre tiene que ser mayor que la de apertura.'
  }
  if (msg.includes('ck_crm_sla_reglas_orden')) {
    return 'El plazo de resolución no puede ser menor que el de primera respuesta.'
  }
  // Los RAISE EXCEPTION de las RPC ya están escritos para leerse.
  return msg.replace(/^.*?:\s*/, '') || 'No se pudo completar la operación.'
}

/** El id del usuario de la sesión. `getUser()` y no `getClaims()`: esto es una
 *  mutación, y acá el viaje de red es barato comparado con lo que cuida. */
async function usuarioActual() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return { supabase, usuarioId: data.user?.id ?? null }
}

function refrescar(casoId?: string) {
  revalidatePath('/rondas/crm')
  if (casoId) revalidatePath(`/rondas/crm/${casoId}`)
}

/* ────────────────────────────── Abrir un caso ─────────────────────────────── */

export async function abrirCaso(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const conversacion = texto(fd, 'conversacion_id')
  const asunto = texto(fd, 'asunto')
  if (!conversacion && !asunto) {
    return { error: 'Un caso sin conversación tiene que llevar al menos un asunto.' }
  }

  const { supabase, usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('crm_caso_abrir', {
    p_conversacion: conversacion,
    p_asunto: asunto,
    p_tipo: texto(fd, 'tipo') ?? 'OTRO',
    p_prioridad: texto(fd, 'prioridad') ?? 'MEDIA',
    p_motivo: texto(fd, 'motivo') ?? 'ABIERTO_EN_CONSOLA',
    p_descripcion: texto(fd, 'descripcion'),
    p_usuario: usuarioId,
    p_canal: conversacion ? 'WHATSAPP' : 'CONSOLA',
  })
  if (error) return { error: traducir(error.message) }

  refrescar()
  return { ok: true, id: data?.id }
}

/* ───────────────────────────────── Asignar ────────────────────────────────── */

export async function asignarCaso(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const casoId = texto(fd, 'caso_id')
  if (!casoId) return { error: 'Falta el caso.' }

  const { supabase, usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('crm_caso_asignar', {
    p_caso: casoId,
    // Vacío = desasignar: el caso vuelve a la bolsa común.
    p_usuario: texto(fd, 'usuario_id'),
    p_motivo: texto(fd, 'motivo'),
    p_asignado_por: usuarioId,
  })
  if (error) return { error: traducir(error.message) }

  refrescar(casoId)
  return { ok: true }
}

/** «Lo tomo yo»: el atajo que de verdad se usa en una bandeja. */
export async function tomarCaso(fd: FormData): Promise<ActionResult> {
  const { usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión.' }
  const copia = new FormData()
  copia.set('caso_id', String(fd.get('caso_id') ?? ''))
  copia.set('usuario_id', usuarioId)
  copia.set('motivo', 'Lo tomó quien estaba en la bandeja')
  return asignarCaso(copia)
}

/* ──────────────────────────────── Etiquetas ───────────────────────────────── */

export async function etiquetarCaso(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const casoId = texto(fd, 'caso_id')
  const etiquetaId = texto(fd, 'etiqueta_id')
  if (!casoId || !etiquetaId) return { error: 'Falta el caso o la etiqueta.' }

  const { supabase, usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión.' }

  const quitar = fd.get('quitar') === '1'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = quitar
    ? await sb.rpc('crm_caso_desetiquetar', { p_caso: casoId, p_etiqueta: etiquetaId })
    : await sb.rpc('crm_caso_etiquetar', {
        p_caso: casoId, p_etiqueta: etiquetaId, p_origen: 'HUMANO', p_usuario: usuarioId,
      })
  if (error) return { error: traducir(error.message) }

  refrescar(casoId)
  return { ok: true }
}

/* ────────────────────────────────── Estado ────────────────────────────────── */

export async function cambiarEstado(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const casoId = texto(fd, 'caso_id')
  const estado = texto(fd, 'estado')
  if (!casoId || !estado) return { error: 'Falta el caso o el estado.' }
  if (estado === 'CERRADO' && !texto(fd, 'motivo')) {
    return { error: 'Cerrar un caso exige decir por qué.' }
  }
  if (estado === 'EN_ESPERA' && !texto(fd, 'motivo')) {
    return { error: 'Poner un caso en espera exige decir qué se está esperando: el reloj se para.' }
  }

  const { supabase, usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('crm_caso_estado', {
    p_caso: casoId, p_estado: estado, p_motivo: texto(fd, 'motivo'), p_usuario: usuarioId,
  })
  if (error) return { error: traducir(error.message) }

  refrescar(casoId)
  return { ok: true }
}

/* ───────────────────────────── La IA: analizar ────────────────────────────── */

/**
 * Clasifica, resume y redacta un BORRADOR de respuesta.
 *
 * Lo que esta acción NO hace, y es a propósito: no envía nada, no cambia el
 * tipo, la prioridad ni el estado del caso. Deja todo en las columnas `*_ia`,
 * que son sugerencias, marcadas con el modelo y la versión del prompt. Para que
 * la respuesta salga hay que aprobarla (`aprobarRespuesta`), y para que la
 * clasificación cuente hay que confirmarla (`confirmarClasificacion`).
 */
export async function analizarCaso(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const casoId = texto(fd, 'caso_id')
  if (!casoId) return { error: 'Falta el caso.' }

  if (!iaActiva()) {
    return { error: `La IA del CRM está apagada. Falta en el entorno: ${faltaParaIa().join(', ')}.` }
  }

  const { supabase } = await usuarioActual()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: caso, error: e1 } = await sb
    .from('crm_casos')
    .select(`id, numero, canal, conversacion_id, grupo_id,
             contrato:grupos_contrato ( nombre ), sede:sedes ( nombre ),
             conversacion:crm_conversaciones ( persona_id )`)
    .eq('id', casoId)
    .single()
  if (e1 || !caso) return { error: 'No se pudo leer el caso.' }
  if (!caso.conversacion_id) return { error: 'El caso no tiene conversación que analizar.' }

  // Los últimos 40 mensajes: es lo que el modelo necesita y lo que no dispara
  // el costo. Se piden descendentes (hay índice) y se dan vuelta.
  //
  // La transcripción de una nota de voz NO está en `crm_mensajes`: vive en
  // `whatsapp_medios.transcripcion` (de F9), una fila por mensaje. Se trae con
  // el mensaje para que el modelo pueda leer lo que alguien dictó, que es la
  // mitad de lo que llega por WhatsApp.
  const { data: msjs } = await sb
    .from('crm_mensajes')
    .select('direccion, tipo, texto, estado, created_at, medio:whatsapp_medios ( transcripcion )')
    .eq('conversacion_id', caso.conversacion_id)
    .in('estado', ['RECIBIDO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'SIMULADO'])
    .order('created_at', { ascending: false })
    .order('id')
    .limit(40)

  type FilaMensaje = MensajeConversacion & {
    medio?: { transcripcion: string | null } | { transcripcion: string | null }[] | null
  }
  const mensajes: MensajeConversacion[] = ((msjs ?? []) as FilaMensaje[])
    .slice()
    .reverse()
    .map((m) => {
      const medio = Array.isArray(m.medio) ? m.medio[0] : m.medio
      return {
        direccion: m.direccion, tipo: m.tipo, texto: m.texto,
        transcripcion: medio?.transcripcion ?? null,
        created_at: m.created_at,
      }
    })

  const { data: etqs } = await sb
    .from('crm_etiquetas')
    .select('codigo, grupo_id')
    .eq('activo', true)
    .order('codigo')

  const disponibles = ((etqs ?? []) as { codigo: string; grupo_id: string | null }[])
    .filter((e) => e.grupo_id === null || e.grupo_id === caso.grupo_id)
    .map((e) => e.codigo)

  const r = await analizarConversacion({
    numero: caso.numero,
    canal: caso.canal,
    contrato: caso.contrato?.nombre ?? null,
    sede: caso.sede?.nombre ?? null,
    etiquetasDisponibles: disponibles,
    identificada: !!caso.conversacion?.persona_id,
    mensajes,
  })

  if (!r.salida) {
    return { error: r.error ?? 'El modelo no devolvió nada utilizable.' }
  }

  const { error: e2 } = await sb.rpc('crm_caso_ia_guardar', {
    p_caso: casoId,
    p_resumen: r.salida.resumen,
    p_clasificacion: {
      asunto: r.salida.asunto,
      etiquetas: r.salida.etiquetas,
      confianza: r.salida.confianza,
      intento_de_instruccion: r.salida.intento_de_instruccion,
      motivo_revision: r.salida.motivo_revision ?? null,
      // Lo que se descartó de la salida del modelo. Si acá aparece `enviar` o
      // `estado`, lo más probable es que un mensaje entrante haya intentado
      // darle instrucciones: queda registrado y no sirvió de nada.
      descartado: r.descartado,
    },
    p_tipo_ia: r.salida.tipo,
    p_prioridad_ia: r.salida.prioridad,
    p_respuesta: r.salida.respuesta_sugerida,
    p_modelo: r.modelo,
    p_prompt_version: r.promptVersion,
    p_confianza: r.salida.confianza,
    p_mensajes: r.mensajesVistos,
  })
  if (e2) return { error: traducir(e2.message) }

  // Las etiquetas que sugirió el modelo entran con `origen = 'IA'`: se ven
  // distintas de las que puso una persona, y confirmarlas las pasa a HUMANO.
  if (r.salida.etiquetas.length > 0) {
    const { data: ids } = await sb
      .from('crm_etiquetas')
      .select('id, codigo')
      .in('codigo', r.salida.etiquetas)
      .eq('activo', true)
    for (const e of (ids ?? []) as { id: string; codigo: string }[]) {
      await sb.rpc('crm_caso_etiquetar', {
        p_caso: casoId, p_etiqueta: e.id, p_origen: 'IA', p_usuario: null,
      })
    }
  }

  refrescar(casoId)
  return {
    ok: true,
    aviso: r.salida.intento_de_instruccion
      ? 'El modelo detectó que la conversación intenta darle instrucciones. La sugerencia está guardada como lo que es: una sugerencia.'
      : r.descartado.length > 0
        ? `Se descartaron campos que el modelo no debía devolver: ${r.descartado.join(', ')}.`
        : undefined,
  }
}

/** Una PERSONA confirma (o corrige) la clasificación sugerida. Es el único
 *  camino por el que `tipo_ia` llega a `tipo`. */
export async function confirmarClasificacion(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const casoId = texto(fd, 'caso_id')
  if (!casoId) return { error: 'Falta el caso.' }

  const { supabase, usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('crm_caso_ia_confirmar', {
    p_caso: casoId,
    p_tipo: texto(fd, 'tipo'),
    p_prioridad: texto(fd, 'prioridad'),
    p_usuario: usuarioId,
    p_aplicar_resumen: fd.get('aplicar_resumen') === 'on' || fd.get('aplicar_resumen') === '1',
  })
  if (error) return { error: traducir(error.message) }

  refrescar(casoId)
  return { ok: true }
}

/* ──────────────────── Aprobar la respuesta: LA ÚNICA PUERTA ───────────────── */

/**
 * Manda la respuesta de un caso. Es el único camino de salida del CRM, y pasa
 * por tres candados: el permiso, `prepararEnvio()` (que exige el usuario que
 * aprueba) y `crm_respuesta_aprobar()` en la base (que lo exige otra vez y
 * verifica que exista).
 *
 * El texto que llega acá puede ser el del modelo tal cual o el que el agente
 * reescribió: las dos cosas valen, porque las dos pasaron por una persona. Lo
 * que no vale es que no haya pasado por nadie.
 */
export async function aprobarRespuesta(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const casoId = texto(fd, 'caso_id')
  if (!casoId) return { error: 'Falta el caso.' }

  const { supabase, usuarioId } = await usuarioActual()
  if (!usuarioId) return { error: 'No hay sesión: una respuesta la aprueba una persona.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: caso, error: e1 } = await sb
    .from('crm_casos')
    .select('id, numero, estado, conversacion_id, respuesta_ia, ia_mensajes_vistos')
    .eq('id', casoId)
    .single()
  if (e1 || !caso) return { error: 'No se pudo leer el caso.' }

  const { count } = await sb
    .from('crm_mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('conversacion_id', caso.conversacion_id)
    .in('estado', ['RECIBIDO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'SIMULADO'])

  const listo = prepararEnvio({
    caso: {
      id: caso.id,
      numero: caso.numero,
      estado: caso.estado,
      conversacionId: caso.conversacion_id,
      respuestaIa: caso.respuesta_ia,
      iaMensajesVistos: caso.ia_mensajes_vistos,
    } satisfies CasoParaAprobar,
    texto: String(fd.get('texto') ?? ''),
    aprobadoPor: usuarioId,
    mensajesAhora: count ?? null,
    confirmaDesactualizado: fd.get('confirma_desactualizado') === '1',
  })
  if (!listo.ok) return { error: listo.error }

  const { data: msg, error: e2 } = await sb.rpc('crm_respuesta_aprobar', {
    p_caso: listo.envio.casoId,
    p_texto: listo.envio.texto,
    p_aprobado_por: listo.envio.aprobadoPor,
    p_prioridad: listo.envio.prioridad,
  })
  if (e2) return { error: traducir(e2.message) }

  refrescar(casoId)

  // Aprobar NO se salta el portero de F9: si está fuera de la ventana de 24
  // horas, fuera de jornada o sin consentimiento, el mensaje nace OMITIDO_* y
  // no sale. Hay que decirlo acá, porque el agente cree que ya respondió.
  const estado: string | undefined = msg?.estado
  if (estado && estado.startsWith('OMITIDO')) {
    return {
      ok: true,
      aviso: `La respuesta quedó registrada pero NO salió (${estado}): ${
        msg?.omitido_motivo ?? 'lo frenó el portero de WhatsApp'}.`,
    }
  }
  return {
    ok: true,
    aviso: listo.origen === 'IA_TAL_CUAL'
      ? 'Salió el borrador de la IA tal cual, aprobado por vos.'
      : listo.origen === 'IA_EDITADA'
        ? 'Salió tu versión del borrador de la IA.'
        : undefined,
  }
}

/* ─────────────────── Parametrización: etiquetas y reglas ──────────────────── */

export async function guardarEtiqueta(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PARAMETRIZA)
  if (falta) return { error: falta }

  const codigo = (texto(fd, 'codigo') ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const nombre = texto(fd, 'nombre')
  if (!codigo || !nombre) return { error: 'La etiqueta necesita código y nombre.' }
  if (!/^[A-Z0-9_]{2,40}$/.test(codigo)) {
    return { error: 'El código va en MAYÚSCULAS, sin espacios, entre 2 y 40 caracteres.' }
  }

  const { supabase } = await usuarioActual()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const fila = {
    codigo,
    nombre,
    color: texto(fd, 'color') ?? '#64748B',
    descripcion: texto(fd, 'descripcion'),
    // Vacío = catálogo general (NULL = aplica a todos los contratos).
    grupo_id: texto(fd, 'grupo_id'),
    activo: fd.get('activo') !== '0',
  }
  const id = texto(fd, 'id')
  const { error } = id
    ? await sb.from('crm_etiquetas').update(fila).eq('id', id)
    : await sb.from('crm_etiquetas').insert(fila)
  if (error) return { error: traducir(error.message) }

  refrescar()
  return { ok: true }
}

export async function guardarReglaSla(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PARAMETRIZA)
  if (falta) return { error: falta }

  const entero = (campo: string) => {
    const n = Number((texto(fd, campo) ?? '').replace(/[^\d]/g, ''))
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }
  const primera = entero('minutos_primera_respuesta')
  const resolucion = entero('minutos_resolucion')
  if (!primera || !resolucion) {
    return { error: 'Hay que decir cuántos minutos para la primera respuesta y cuántos para resolver.' }
  }
  if (resolucion < primera) {
    return { error: 'El plazo de resolución no puede ser menor que el de primera respuesta.' }
  }

  const { supabase } = await usuarioActual()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const fila = {
    grupo_id: texto(fd, 'grupo_id'),
    tipo: texto(fd, 'tipo'),
    prioridad: texto(fd, 'prioridad') ?? 'MEDIA',
    minutos_primera_respuesta: primera,
    minutos_resolucion: resolucion,
    horas_habiles: fd.get('horas_habiles') !== '0',
    jornada_desde: texto(fd, 'jornada_desde') ?? '08:00',
    jornada_hasta: texto(fd, 'jornada_hasta') ?? '17:00',
    observacion: texto(fd, 'observacion'),
    activo: fd.get('activo') !== '0',
  }
  const id = texto(fd, 'id')
  const { error } = id
    ? await sb.from('crm_sla_reglas').update(fila).eq('id', id)
    : await sb.from('crm_sla_reglas').insert(fila)
  if (error) return { error: traducir(error.message) }

  // Cambiar un tope NO re-calcula lo ya abierto: cada caso guarda en `crm_sla`
  // los minutos con los que nació. Hay que decirlo, porque lo contrario sería
  // lo que la mayoría espera.
  refrescar()
  return {
    ok: true,
    aviso: 'El tope nuevo aplica a los casos que se abran de ahora en adelante. Los que ya están abiertos conservan el plazo con el que nacieron.',
  }
}
