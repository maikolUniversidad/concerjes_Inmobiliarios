'use server'

// Escrituras de las plantillas de tarea y sus pasos (F3 del módulo de Puntos QR).
//
// Dos caminos, como manda el ADR-E:
//   · PUBLICAR y SACAR UNA VERSIÓN NUEVA van por RPC `SECURITY DEFINER`
//     (`ronda_plantilla_publicar`, `ronda_plantilla_nueva_version`): son una
//     máquina de estados con validaciones que la RLS no puede expresar —que no
//     falte ningún paso, que ningún paso condicional dependa de uno posterior,
//     que la versión anterior se archive en la misma transacción— y el clon
//     tiene que rehacer las referencias condicionales dentro de la copia.
//   · El resto, server action + RLS: la política ya exige
//     `gestionar_catalogo_rondas` más el contrato en el alcance, y el congelado
//     de la base impide tocar lo publicado aunque la UI se equivoque.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import {
  TIPOS_PASO, PASO_META, validarConfigPaso, type ConfigPaso, type TipoPaso,
} from '@/lib/ronda/pasos'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

const PERMISO = 'gestionar_catalogo_rondas'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function entero(fd: FormData, campo: string): number | null {
  const s = texto(fd, campo)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true'

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese contrato no está en tu alcance.'
  }
  if (msg.includes('no se pueden tocar') || msg.includes('no se puede modificar')) {
    return 'Esa plantilla ya está publicada y no se puede cambiar. Saca una versión nueva.'
  }
  if (msg.includes('ux_ronda_pasos_orden')) return 'Ya hay un paso en esa posición.'
  if (msg.includes('ux_ronda_plantillas_pub')) {
    return 'Ya hay otra versión publicada de ese código en ese ámbito.'
  }
  if (msg.includes('ux_ronda_plantillas')) return 'Ya existe esa versión de ese código.'
  if (msg.includes('ck_paso_config')) return 'La configuración del paso no es válida para su tipo.'
  if (msg.includes('ck_plantilla_codigo')) {
    return 'El código va en MAYÚSCULAS y sin espacios (por ejemplo ASEO_BANOS).'
  }
  return 'No se pudo guardar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

function refrescar(id?: string | null) {
  revalidatePath('/rondas/plantillas')
  if (id) revalidatePath(`/rondas/plantillas/${id}`)
}

// ── Plantilla ────────────────────────────────────────────────────────────────

/** Crea una plantilla nueva (versión 1, en BORRADOR) y abre su editor. */
export async function crearPlantilla(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const codigo = (texto(fd, 'codigo') ?? '').toUpperCase().replace(/\s+/g, '_')
  if (!/^[A-Z0-9_]{2,40}$/.test(codigo)) {
    return { error: 'El código va en MAYÚSCULAS, sin tildes ni espacios, de 2 a 40 caracteres.' }
  }
  const nombre = texto(fd, 'nombre')
  if (!nombre) return { error: 'El nombre es obligatorio.' }
  const tipo = texto(fd, 'tipo_actividad_id')
  if (!tipo) return { error: 'Hay que decir de qué actividad es la plantilla.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data, error } = await sb.from('ronda_plantillas').insert({
    grupo_id: texto(fd, 'grupo_id'),
    tipo_actividad_id: tipo,
    codigo,
    version: 1,
    nombre,
    descripcion: texto(fd, 'descripcion'),
    estado: 'BORRADOR',
    duracion_estimada_min: entero(fd, 'duracion_estimada_min'),
    exige_firma: marcado(fd, 'exige_firma'),
    exige_geocerca: marcado(fd, 'exige_geocerca'),
  }).select('id').single()
  if (error) return { error: traducir(error.message) }

  refrescar()
  redirect(`/rondas/plantillas/${data.id}`)
}

/** Guarda la cabecera de una plantilla en BORRADOR. */
export async function guardarPlantilla(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = texto(fd, 'id')
  if (!id) return { error: 'Plantilla no especificada.' }

  const nombre = texto(fd, 'nombre')
  if (!nombre) return { error: 'El nombre es obligatorio.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error } = await sb.from('ronda_plantillas').update({
    nombre,
    descripcion: texto(fd, 'descripcion'),
    tipo_actividad_id: texto(fd, 'tipo_actividad_id'),
    duracion_estimada_min: entero(fd, 'duracion_estimada_min'),
    exige_firma: marcado(fd, 'exige_firma'),
    exige_geocerca: marcado(fd, 'exige_geocerca'),
  }).eq('id', id)
  if (error) return { error: traducir(error.message) }

  refrescar(id)
  return { ok: true }
}

/** Publica la plantilla. Toda la validación está en la RPC. */
export async function publicarPlantilla(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = texto(fd, 'id')
  if (!id) return { error: 'Plantilla no especificada.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error } = await sb.rpc('ronda_plantilla_publicar', { p_plantilla: id })
  // El mensaje de la RPC ya viene en español y dice qué arreglar.
  if (error) return { error: error.message }

  refrescar(id)
  return { ok: true }
}

/**
 * Saca una versión nueva en BORRADOR y abre su editor. Con `grupo_id`, la
 * copia es el AJUSTE de ese contrato sobre la plantilla general.
 */
export async function nuevaVersion(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const id = texto(fd, 'id')
  if (!id) return { error: 'Plantilla no especificada.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data, error } = await sb.rpc('ronda_plantilla_nueva_version', {
    p_plantilla: id, p_grupo: texto(fd, 'grupo_id'),
  })
  if (error) return { error: error.message }

  refrescar(id)
  redirect(`/rondas/plantillas/${data}`)
}

/** Archiva una plantilla publicada: deja de asignarse, pero se sigue leyendo. */
export async function archivarPlantilla(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb, user } = await cliente()
  if (!user) return
  await sb.from('ronda_plantillas').update({ estado: 'ARCHIVADA' }).eq('id', id)
  refrescar(id)
}

/** Borra un BORRADOR. La base impide borrar lo publicado. */
export async function eliminarPlantilla(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb, user } = await cliente()
  if (!user) return
  await sb.from('ronda_plantillas').delete().eq('id', id)
  revalidatePath('/rondas/plantillas')
  redirect('/rondas/plantillas')
}

// ── Pasos ────────────────────────────────────────────────────────────────────

/**
 * Crea o actualiza un paso. La `config` llega como JSON desde el editor, que ya
 * la armó con los campos propios del tipo; aquí se valida con la misma lógica
 * que el CHECK de la base (lib/ronda/pasos.ts) para dar un mensaje legible.
 */
export async function guardarPaso(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const plantillaId = texto(fd, 'plantilla_id')
  if (!plantillaId) return { error: 'Plantilla no especificada.' }

  const tipo = String(fd.get('tipo') ?? '') as TipoPaso
  if (!TIPOS_PASO.includes(tipo)) return { error: 'Tipo de paso no válido.' }
  const titulo = texto(fd, 'titulo')
  if (!titulo) return { error: 'El título del paso es obligatorio.' }

  let config: ConfigPaso
  try {
    const crudo = texto(fd, 'config')
    config = crudo ? JSON.parse(crudo) : PASO_META[tipo].porDefecto
  } catch {
    return { error: 'La configuración del paso no se pudo leer.' }
  }
  const problema = validarConfigPaso(tipo, config)
  if (problema) return { error: problema }

  const orden = entero(fd, 'orden')
  if (orden === null || orden < 1 || orden > 200) return { error: 'El orden va de 1 a 200.' }

  const condicion = texto(fd, 'condicion_paso_id')
  const valor = texto(fd, 'condicion_valor')
  if (!!condicion !== !!valor) {
    return { error: 'Un paso condicional necesita el paso del que depende Y la respuesta que lo activa.' }
  }
  const instructivo = texto(fd, 'instructivo_id')

  const fila = {
    plantilla_id: plantillaId,
    orden,
    tipo,
    titulo,
    ayuda: texto(fd, 'ayuda'),
    obligatorio: marcado(fd, 'obligatorio'),
    instructivo_id: instructivo,
    instructivo_momento: instructivo ? (texto(fd, 'instructivo_momento') ?? 'ANTES') : null,
    condicion_paso_id: condicion,
    condicion_valor: valor,
    config,
  }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = texto(fd, 'id')
  const { error } = id
    ? await sb.from('ronda_plantilla_pasos').update(fila).eq('id', id)
    : await sb.from('ronda_plantilla_pasos').insert(fila)
  if (error) return { error: traducir(error.message) }

  refrescar(plantillaId)
  return { ok: true }
}

/** Borra un paso del borrador. Falla si otro paso depende de él, y está bien. */
export async function eliminarPaso(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb, user } = await cliente()
  if (!user) return
  const { data: fila } = await sb.from('ronda_plantilla_pasos')
    .select('plantilla_id').eq('id', id).maybeSingle()
  await sb.from('ronda_plantilla_pasos').delete().eq('id', id)
  refrescar(fila?.plantilla_id)
}

/**
 * Sube o baja un paso intercambiándolo con su vecino.
 *
 * Son TRES actualizaciones, no dos: `(plantilla_id, orden)` es único, así que
 * poner el paso en el orden del vecino antes de mover al vecino choca con el
 * índice. El paso se aparca en un orden libre, el vecino toma el suyo y el paso
 * cae en el del vecino.
 */
export async function moverPaso(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  const hacia = String(fd.get('hacia') ?? '')
  if (!id || (hacia !== 'arriba' && hacia !== 'abajo')) return

  const { sb, user } = await cliente()
  if (!user) return

  const { data: paso } = await sb.from('ronda_plantilla_pasos')
    .select('id, plantilla_id, orden').eq('id', id).maybeSingle()
  if (!paso) return

  const { data: todos } = await sb.from('ronda_plantilla_pasos')
    .select('id, orden').eq('plantilla_id', paso.plantilla_id).order('orden')
  const lista: { id: string; orden: number }[] = todos ?? []

  const vecino = hacia === 'arriba'
    ? [...lista].reverse().find((p) => p.orden < paso.orden)
    : lista.find((p) => p.orden > paso.orden)
  if (!vecino) return

  // Orden de parqueo: el primer valor de 1 a 200 que nadie esté usando. El
  // CHECK de la tabla no admite nada fuera de ese rango.
  const usados = new Set(lista.map((p) => p.orden))
  let libre = 0
  for (let n = 1; n <= 200; n++) if (!usados.has(n)) { libre = n; break }
  if (!libre) return                                  // 200 pasos: nada que mover

  await sb.from('ronda_plantilla_pasos').update({ orden: libre }).eq('id', paso.id)
  await sb.from('ronda_plantilla_pasos').update({ orden: paso.orden }).eq('id', vecino.id)
  await sb.from('ronda_plantilla_pasos').update({ orden: vecino.orden }).eq('id', paso.id)

  refrescar(paso.plantilla_id)
}
