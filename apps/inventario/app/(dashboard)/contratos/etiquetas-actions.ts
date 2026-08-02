'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult { error?: string; ok?: boolean }

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'No tienes permisos (requiere rol Admin).'
  if (msg.includes('duplicate')) return 'Ya existe un elemento con ese nombre.'
  return 'Operación fallida: ' + msg
}

async function sb() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: supabase as any, user }
}

// ── Categorías ────────────────────────────────────────────────────────────────
export async function guardarCategoria(input: {
  id?: string; nombre: string; descripcion?: string | null; color?: string; multiple?: boolean
}): Promise<ActionResult> {
  const { db, user } = await sb()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const nombre = input.nombre.trim()
  if (nombre.length < 2) return { error: 'El nombre de la categoría es obligatorio.' }
  const fila = { nombre, descripcion: input.descripcion?.trim() || null, color: input.color || 'gray', multiple: input.multiple ?? true }
  const { error } = input.id
    ? await db.from('etiqueta_categorias').update(fila).eq('id', input.id)
    : await db.from('etiqueta_categorias').insert(fila)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

export async function eliminarCategoria(id: string): Promise<ActionResult> {
  const { db, user } = await sb()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const { error } = await db.from('etiqueta_categorias').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

// ── Etiquetas (valores) ───────────────────────────────────────────────────────
export async function guardarEtiqueta(input: {
  id?: string; categoria_id: string; nombre: string; color?: string | null
}): Promise<ActionResult> {
  const { db, user } = await sb()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const nombre = input.nombre.trim()
  if (!input.categoria_id) return { error: 'Falta la categoría.' }
  if (nombre.length < 1) return { error: 'El nombre de la etiqueta es obligatorio.' }
  const fila = { categoria_id: input.categoria_id, nombre, color: input.color || null }
  const { error } = input.id
    ? await db.from('etiquetas').update({ nombre, color: input.color || null }).eq('id', input.id)
    : await db.from('etiquetas').insert(fila)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

export async function eliminarEtiqueta(id: string): Promise<ActionResult> {
  const { db, user } = await sb()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const { error } = await db.from('etiquetas').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

// ── Clasificación a nivel de grupo de contrato ────────────────────────────────
export async function setTipoGrupo(grupoId: string, tipo: 'DIRECTO' | 'PRIVADO' | null): Promise<ActionResult> {
  const { db, user } = await sb()
  if (!user) return { error: 'Debes iniciar sesión.' }
  const { error } = await db.from('grupos_contrato').update({ tipo_contrato: tipo }).eq('id', grupoId)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/contratos')
  return { ok: true }
}

export async function asignarEtiquetasGrupo(grupoId: string, etiquetaIds: string[]): Promise<ActionResult> {
  const { db, user } = await sb()
  if (!user) return { error: 'Debes iniciar sesión.' }
  await db.from('grupo_etiquetas').delete().eq('grupo_id', grupoId)
  const limpias = [...new Set(etiquetaIds.filter(Boolean))]
  if (limpias.length) {
    const { error } = await db.from('grupo_etiquetas').insert(limpias.map((etiqueta_id) => ({ grupo_id: grupoId, etiqueta_id })))
    if (error) return { error: traducir(error.message) }
  }
  revalidatePath('/contratos')
  return { ok: true }
}
