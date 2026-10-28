'use server'

// Escrituras del catálogo de categorías de PQRS (F5 de Puntos QR).
//
// Van por tabla y no por RPC a propósito: la RLS de `pqrs_categorias` ya exige
// `parametrizar_pqrs` en lectura y escritura, y aquí no hay ninguna regla de
// negocio que la base no pueda expresar. Lo que sí se hace es comprobar el
// permiso ANTES para poder devolver un mensaje entendible en vez del error de
// RLS, que es lo que hace el resto de la aplicación.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'

export interface ResultadoCategoria { error?: string; ok?: boolean }

const TIPOS = ['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'FELICITACION']
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA']

function traducir(msg: string): string {
  if (/ux_pqrs_categorias_general/.test(msg)) {
    return 'Ya existe una categoría general con ese código.'
  }
  if (/ux_pqrs_categorias_grupo/.test(msg)) {
    return 'Ese contrato ya tiene una categoría con ese código.'
  }
  if (/pqrs_categorias_codigo_chk/.test(msg)) {
    return 'El código solo admite letras sin tilde, números y _ (de 2 a 30 caracteres).'
  }
  if (/row-level security/.test(msg)) {
    return 'No tienes permiso para cambiar el catálogo de PQRS.'
  }
  return 'No se pudo guardar: ' + msg
}

export async function guardarCategoria(
  _prev: ResultadoCategoria, formData: FormData,
): Promise<ResultadoCategoria> {
  const falta = await faltaPermiso('parametrizar_pqrs')
  if (falta) return { error: falta }

  const id = String(formData.get('id') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const codigo = String(formData.get('codigo') ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const tipo = String(formData.get('tipo_sugerido') ?? 'QUEJA').toUpperCase()
  const prioridad = String(formData.get('prioridad_sugerida') ?? 'MEDIA').toUpperCase()

  if (nombre.length < 3) return { error: 'Escribe un nombre que el residente entienda.' }
  if (codigo.length < 2) return { error: 'El código es obligatorio (p. ej. LIMPIEZA).' }
  if (!TIPOS.includes(tipo)) return { error: 'Tipo de PQRS inválido.' }
  if (!PRIORIDADES.includes(prioridad)) return { error: 'Prioridad inválida.' }

  const fila = {
    codigo,
    nombre,
    descripcion: String(formData.get('descripcion') ?? '').trim() || null,
    tipo_sugerido: tipo,
    prioridad_sugerida: prioridad,
    orden: Number(String(formData.get('orden') ?? '0').replace(/\D/g, '')) || 0,
    activo: formData.get('activo') != null,
    // Vacío = categoría general, que es la que ven todos los contratos.
    grupo_id: String(formData.get('grupo_id') ?? '').trim() || null,
  }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = id
    ? await sb.from('pqrs_categorias').update(fila).eq('id', id)
    : await sb.from('pqrs_categorias').insert(fila)
  if (error) return { error: traducir(error.message) }

  revalidatePath('/pqrs/categorias')
  return { ok: true }
}

/** Apagar o volver a encender una categoría. No se borra: borrarla dejaría sin
 *  categoría las PQRS ya radicadas con ella. */
export async function cambiarActivoCategoria(id: string, activo: boolean): Promise<ResultadoCategoria> {
  const falta = await faltaPermiso('parametrizar_pqrs')
  if (falta) return { error: falta }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb.from('pqrs_categorias').update({ activo }).eq('id', id)
  if (error) return { error: traducir(error.message) }
  revalidatePath('/pqrs/categorias')
  return { ok: true }
}
