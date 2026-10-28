'use server'

// Escrituras de los planes preventivos (F7 del módulo de Puntos QR).
//
// Van por server action + RLS y no por una RPC con máquina de estados, porque
// un plan no tiene estados: es catálogo. La política `mant_planes_write` de la
// migración ya exige `gestionar_mantenimiento` MÁS el contrato en el alcance
// (`auth_grupos()`), así que la validación de verdad está en la base y esto
// solo arma la fila.
//
// Lo que NO se escribe desde aquí: los tickets. Un preventivo nace llamando a
// `mant_generar_preventivos()` desde el tablero, que es idempotente y decide
// con la vista `vw_mant_plan_proximos` a qué objeto le toca. Que la pantalla de
// planes pudiera crear órdenes a mano abriría la puerta a duplicarlas.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

const GESTIONA = 'gestionar_mantenimiento'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function numero(fd: FormData, campo: string): number | null {
  const s = texto(fd, campo)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
function entero(fd: FormData, campo: string, porDefecto: number): number {
  const n = numero(fd, campo)
  return n == null ? porDefecto : Math.max(0, Math.round(n))
}

/** Arma la fila del plan desde el formulario, con las reglas que la base
 *  también exige (para dar un mensaje claro antes de ir al servidor). */
function filaDesdeForm(fd: FormData): { fila?: Record<string, unknown>; error?: string } {
  const nombre = texto(fd, 'nombre')
  if (!nombre) return { error: 'El plan necesita un nombre.' }

  const objetoTipo = String(fd.get('objeto_tipo') ?? 'TIPO')
  const activoTipo = texto(fd, 'activo_tipo_id')
  const activo = texto(fd, 'activo_id')
  const maquinaria = texto(fd, 'maquinaria_id')

  // Exactamente uno de los tres (CHECK `mant_planes_objeto`).
  const objeto =
    objetoTipo === 'TIPO' ? { activo_tipo_id: activoTipo, activo_id: null, maquinaria_id: null }
    : objetoTipo === 'ACTIVO' ? { activo_tipo_id: null, activo_id: activo, maquinaria_id: null }
    : { activo_tipo_id: null, activo_id: null, maquinaria_id: maquinaria }
  if (!objeto.activo_tipo_id && !objeto.activo_id && !objeto.maquinaria_id) {
    return { error: 'Elige a qué se aplica el plan: un tipo de activo, un activo o un equipo propio.' }
  }

  const frecuenciaTipo = String(fd.get('frecuencia_tipo') ?? 'MESES')
  const frecuenciaValor = numero(fd, 'frecuencia_valor')
  if (frecuenciaValor == null || frecuenciaValor <= 0) {
    return { error: 'La frecuencia tiene que ser un número mayor que cero.' }
  }
  const medidor = texto(fd, 'medidor_id')
  if (frecuenciaTipo === 'MEDIDOR' && !medidor) {
    return { error: 'Un plan por medidor necesita que elijas el medidor del activo.' }
  }

  return {
    fila: {
      nombre,
      descripcion: texto(fd, 'descripcion'),
      grupo_id: texto(fd, 'grupo_id'),
      ...objeto,
      frecuencia_tipo: frecuenciaTipo,
      frecuencia_valor: frecuenciaValor,
      medidor_id: frecuenciaTipo === 'MEDIDOR' ? medidor : null,
      anticipacion_dias: entero(fd, 'anticipacion_dias', 7),
      tolerancia_dias: entero(fd, 'tolerancia_dias', 0),
      vence_alerta_dias: entero(fd, 'vence_alerta_dias', 3),
      obligatorio_normativo: fd.get('obligatorio_normativo') === 'on',
      normativa: texto(fd, 'normativa'),
      tipo_ticket: String(fd.get('tipo_ticket') ?? 'PREVENTIVO'),
      prioridad: String(fd.get('prioridad') ?? 'MEDIA'),
      duracion_estimada_min: numero(fd, 'duracion_estimada_min'),
      asignado_a: texto(fd, 'asignado_a'),
      proveedor_id: texto(fd, 'proveedor_id'),
      activo: fd.get('activo') !== 'off',
    },
  }
}

export async function guardarPlan(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const { fila, error } = filaDesdeForm(fd)
  if (error || !fila) return { error }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const id = String(fd.get('id') ?? '').trim()

  if (id) {
    const { error: e } = await sb.from('mant_planes').update(fila).eq('id', id)
    if (e) return { error: e.message }
    revalidatePath('/mantenimiento/planes')
    return { ok: true, id }
  }

  const { data: { user } } = await supabase.auth.getUser()
  const { data, error: e } = await sb.from('mant_planes')
    .insert({ ...fila, created_by: user?.id ?? null })
    .select('id').single()
  if (e) return { error: e.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true, id: data?.id }
}

/** Un plan no se borra si ya generó órdenes: se desactiva. Borrarlo dejaría los
 *  tickets con `plan_id` nulo y el histórico sin de dónde salieron. */
export async function cambiarActivoPlan(id: string, activo: boolean): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('mant_planes').update({ activo }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true }
}

export async function borrarPlan(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { count } = await sb.from('mantenimiento_tickets')
    .select('id', { count: 'exact', head: true }).eq('plan_id', id)
  if ((count ?? 0) > 0) {
    return { error: `Este plan ya generó ${count} orden(es): desactívalo en vez de borrarlo, para no perder de dónde salieron.` }
  }

  const { error } = await sb.from('mant_planes').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true }
}

// ── Tareas del plan (plantillas del motor de F4) ────────────────────────────

export async function guardarTarea(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const plan = texto(fd, 'plan_id')
  const plantilla = texto(fd, 'plantilla_id')
  if (!plan) return { error: 'Falta el plan.' }
  if (!plantilla) return { error: 'Elige la tarea del catálogo.' }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // El orden siguiente, para no pelearse con el UNIQUE (plan_id, orden).
  const { data: ult } = await sb.from('mant_plan_tareas')
    .select('orden').eq('plan_id', plan).order('orden', { ascending: false }).limit(1).maybeSingle()

  const { error } = await sb.from('mant_plan_tareas').insert({
    plan_id: plan,
    plantilla_id: plantilla,
    orden: (ult?.orden ?? 0) + 1,
    descripcion: texto(fd, 'descripcion'),
  })
  if (error) return { error: error.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true }
}

export async function borrarTarea(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('mant_plan_tareas').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true }
}

// ── Materiales esperados (no mueven stock: solo sirven para alistar) ────────

export async function guardarMaterialPlan(fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const plan = texto(fd, 'plan_id')
  const producto = texto(fd, 'producto_id')
  const cantidad = numero(fd, 'cantidad')
  if (!plan || !producto) return { error: 'Falta el plan o el material.' }
  if (cantidad == null || cantidad <= 0) return { error: 'La cantidad tiene que ser mayor que cero.' }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('mant_plan_materiales')
    .upsert({ plan_id: plan, producto_id: producto, cantidad }, { onConflict: 'plan_id,producto_id' })
  if (error) return { error: error.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true }
}

export async function borrarMaterialPlan(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('mant_plan_materiales').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/mantenimiento/planes')
  return { ok: true }
}
