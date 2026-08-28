'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { cargarCuenta, crearTransporte, motivoNoEnvia, puedeEnviar, remitente } from '@/lib/email/transport'
import {
  htmlATexto, payloadEjemplo, renderPlantilla, sanearHtml, slug, variablesUsadas,
  type VariablePlantilla,
} from '@/lib/email/plantillas'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const RUTA = '/notificaciones/plantillas'

async function auth(permiso: string) {
  const supabase = await createClient() as DB
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, error: 'Debes iniciar sesión.' }
  const permisos = await getPermisosUsuario()
  if (!permisos.puede(permiso)) return { supabase, user, error: 'No tienes permiso para esta acción.' }
  return { supabase, user, error: null }
}

/** Variables declaradas a mano + las que aparecen en el cuerpo, sin duplicar. */
function combinarVariables(declaradas: string, asunto: string, html: string, texto: string): VariablePlantilla[] {
  const mapa = new Map<string, VariablePlantilla>()

  // Formato del textarea: una por línea, `clave: descripción`.
  for (const linea of declaradas.split('\n')) {
    const l = linea.trim()
    if (!l) continue
    const [clave, ...resto] = l.split(':')
    const key = clave.trim()
    if (key) mapa.set(key, { clave: key, descripcion: resto.join(':').trim() || undefined })
  }
  for (const clave of variablesUsadas(asunto, html, texto)) {
    if (!mapa.has(clave)) mapa.set(clave, { clave })
  }
  return [...mapa.values()]
}

/** Crea o actualiza una plantilla de correo. */
export async function guardarPlantilla(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user, error: authError } = await auth('gestionar_plantillas_correo')
  if (authError) return { error: authError }

  const id = String(formData.get('id') ?? '').trim() || null
  const nombre = String(formData.get('nombre') ?? '').trim()
  const asunto = String(formData.get('asunto') ?? '').trim()
  const htmlCrudo = String(formData.get('cuerpo_html') ?? '').trim()

  if (nombre.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres.' }
  if (!asunto) return { error: 'Escribe el asunto del correo.' }
  if (htmlCrudo.length < 10) return { error: 'El cuerpo del correo está vacío.' }

  const cuerpo_html = sanearHtml(htmlCrudo)
  const cuerpo_texto = String(formData.get('cuerpo_texto') ?? '').trim() || htmlATexto(cuerpo_html)
  const codigo = String(formData.get('codigo') ?? '').trim() || slug(nombre)
  const origen = String(formData.get('origen') ?? 'EDITOR') === 'ARCHIVO' ? 'ARCHIVO' : 'EDITOR'

  const fila = {
    codigo,
    nombre,
    descripcion: String(formData.get('descripcion') ?? '').trim() || null,
    categoria: String(formData.get('categoria') ?? '').trim() || 'General',
    asunto,
    cuerpo_html,
    cuerpo_texto,
    variables: combinarVariables(String(formData.get('variables') ?? ''), asunto, cuerpo_html, cuerpo_texto),
    origen,
    archivo_nombre: String(formData.get('archivo_nombre') ?? '').trim() || null,
    activa: formData.get('activa') !== 'off',
  }

  let resultId = id
  let error
  if (id) {
    ({ error } = await supabase.from('plantillas_correo').update(fila).eq('id', id))
  } else {
    const res = await supabase
      .from('plantillas_correo')
      .insert({ ...fila, creado_por: user!.id })
      .select('id').single()
    error = res.error
    resultId = res.data?.id ?? null
  }

  if (error) {
    if (/duplicate key/i.test(error.message)) return { error: `Ya existe una plantilla con el código "${codigo}".` }
    if (/row-level security|permission/i.test(error.message)) return { error: 'No tienes permiso para gestionar plantillas.' }
    return { error: 'No se pudo guardar la plantilla: ' + error.message }
  }

  await logActivity(supabase, {
    accion: id ? 'UPDATE' : 'CREATE',
    modulo: 'Sistema',
    descripcion: `${id ? 'Actualizó' : 'Creó'} la plantilla de correo "${nombre}"`,
    entidad: 'PlantillaCorreo',
    entidad_id: resultId ?? undefined,
  })

  revalidatePath(RUTA)
  return { ok: true, id: resultId ?? undefined }
}

/** Elimina una plantilla (las de sistema no se pueden borrar). */
export async function eliminarPlantilla(id: string): Promise<ActionResult> {
  const { supabase, error: authError } = await auth('gestionar_plantillas_correo')
  if (authError) return { error: authError }

  const { data: plantilla } = await supabase
    .from('plantillas_correo').select('nombre, es_sistema').eq('id', id).maybeSingle()
  if (!plantilla) return { error: 'La plantilla ya no existe.' }
  if (plantilla.es_sistema) return { error: 'Las plantillas del sistema no se pueden eliminar. Puedes desactivarlas.' }

  const { count } = await supabase
    .from('flujo_pasos').select('id', { count: 'exact', head: true }).eq('plantilla_id', id)
  if ((count ?? 0) > 0) {
    return { error: `La plantilla está en uso por ${count} paso(s) de flujo. Quítala de esos pasos o desactívala.` }
  }

  const { error } = await supabase.from('plantillas_correo').delete().eq('id', id)
  if (error) return { error: 'No se pudo eliminar: ' + error.message }

  await logActivity(supabase, {
    accion: 'DELETE', modulo: 'Sistema',
    descripcion: `Eliminó la plantilla de correo "${plantilla.nombre}"`,
    entidad: 'PlantillaCorreo', entidad_id: id,
  })
  revalidatePath(RUTA)
  return { ok: true }
}

/** Activa o desactiva una plantilla sin abrir el editor. */
export async function alternarPlantilla(id: string, activa: boolean): Promise<ActionResult> {
  const { supabase, error: authError } = await auth('gestionar_plantillas_correo')
  if (authError) return { error: authError }
  const { error } = await supabase.from('plantillas_correo').update({ activa }).eq('id', id)
  if (error) return { error: 'No se pudo actualizar: ' + error.message }
  revalidatePath(RUTA)
  return { ok: true }
}

/**
 * Envía la plantilla a una dirección de prueba, con los valores de ejemplo de
 * cada variable. Sale directo por SMTP (no pasa por el buzón) para que el
 * administrador vea el resultado en el momento.
 */
export async function enviarPruebaPlantilla(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, error: authError } = await auth('gestionar_plantillas_correo')
  if (authError) return { error: authError }

  const id = String(formData.get('id') ?? '')
  const para = String(formData.get('para') ?? '').trim()
  if (!id) return { error: 'Guarda la plantilla antes de probarla.' }

  const { data: plantilla } = await supabase
    .from('plantillas_correo')
    .select('nombre, asunto, cuerpo_html, cuerpo_texto, variables')
    .eq('id', id).maybeSingle()
  if (!plantilla) return { error: 'La plantilla ya no existe.' }

  const cuenta = await cargarCuenta(supabase)
  if (!puedeEnviar(cuenta)) return { error: motivoNoEnvia(cuenta) }

  const destino = para || cuenta.from_email!
  const render = renderPlantilla(plantilla, payloadEjemplo((plantilla.variables ?? []) as VariablePlantilla[]))

  try {
    const transport = await crearTransporte(supabase, cuenta)
    await transport.sendMail({
      from: remitente(cuenta),
      to: destino,
      subject: `[Prueba] ${render.asunto}`,
      text: render.texto,
      html: render.html,
    })
  } catch (e) {
    return { error: 'No se pudo enviar: ' + (e instanceof Error ? e.message : 'error') }
  }

  await logActivity(supabase, {
    accion: 'CREATE', modulo: 'Sistema',
    descripcion: `Envió una prueba de la plantilla "${plantilla.nombre}" a ${destino}`,
    entidad: 'PlantillaCorreo', entidad_id: id,
  })
  return { ok: true }
}
