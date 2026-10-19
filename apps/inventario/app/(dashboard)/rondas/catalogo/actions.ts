'use server'

// Escrituras del catálogo de tipos de actividad (F3 del módulo de Puntos QR).
//
// Server action + RLS, no RPC: aquí no hay máquina de estados ni bitácora que
// proteger, y la política de la migración ya exige `gestionar_catalogo_rondas`
// MÁS el contrato en el alcance. Lo que SÍ va por RPC es publicar y versionar
// una plantilla (ADR-E); eso está en ../plantillas/actions.ts.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { CATEGORIAS_ACTIVIDAD, type CategoriaActividad } from '@/lib/ronda/pasos'

export interface ActionResult { error?: string; ok?: boolean }

const PERMISO = 'gestionar_catalogo_rondas'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true'

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese contrato no está en tu alcance.'
  }
  if (msg.includes('ux_ronda_tipos_general') || msg.includes('ux_ronda_tipos_grupo')) {
    return 'Ya hay una actividad con ese código en ese ámbito.'
  }
  if (msg.includes('ck_tipo_actividad_codigo')) {
    return 'El código va en MAYÚSCULAS y sin espacios (por ejemplo LECTURA_MEDIDOR).'
  }
  if (msg.includes('violates foreign key')) {
    return 'No se puede borrar: hay plantillas o instructivos usando esa actividad.'
  }
  return 'No se pudo guardar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

/** Crea o actualiza un tipo de actividad. Sin `id` en el formulario, crea. */
export async function guardarTipo(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const codigo = (texto(fd, 'codigo') ?? '').toUpperCase().replace(/\s+/g, '_')
  if (!codigo) return { error: 'El código es obligatorio.' }
  if (!/^[A-Z0-9_]{2,40}$/.test(codigo)) {
    return { error: 'El código va en MAYÚSCULAS, sin tildes ni espacios, de 2 a 40 caracteres.' }
  }
  const nombre = texto(fd, 'nombre')
  if (!nombre) return { error: 'El nombre es obligatorio.' }

  const categoria = String(fd.get('categoria') ?? 'OTRA') as CategoriaActividad
  if (!CATEGORIAS_ACTIVIDAD.includes(categoria)) return { error: 'Categoría no válida.' }

  const orden = Number(texto(fd, 'orden') ?? '0')
  const fila = {
    // NULL = catálogo general, aplica a todos los contratos.
    grupo_id: texto(fd, 'grupo_id'),
    codigo,
    nombre,
    descripcion: texto(fd, 'descripcion'),
    categoria,
    icono: texto(fd, 'icono'),
    color: texto(fd, 'color'),
    orden: Number.isFinite(orden) ? Math.round(orden) : 0,
    activo: marcado(fd, 'activo'),
  }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = texto(fd, 'id')
  const { error } = id
    ? await sb.from('ronda_tipos_actividad').update(fila).eq('id', id)
    : await sb.from('ronda_tipos_actividad').insert(fila)
  if (error) return { error: traducir(error.message) }

  revalidatePath('/rondas/catalogo')
  return { ok: true }
}

/** Borra un tipo de actividad. Falla si alguna plantilla lo usa, y está bien. */
export async function eliminarTipo(fd: FormData): Promise<void> {
  if (await faltaPermiso(PERMISO)) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb, user } = await cliente()
  if (!user) return
  await sb.from('ronda_tipos_actividad').delete().eq('id', id)
  revalidatePath('/rondas/catalogo')
}
