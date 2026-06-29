'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { CategoriaRotacion, TipoInsumo } from '@/lib/types/database'

export interface ActionResult { error?: string }

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function crearProducto(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const nombre = String(formData.get('nombre_estandar') ?? '').trim()
  if (nombre.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres.' }

  const insert = {
    nombre_estandar: nombre,
    presentacion: String(formData.get('presentacion') ?? '').trim() || null,
    tipo_insumo: (String(formData.get('tipo_insumo') ?? 'OTROS') as TipoInsumo),
    cat_rotacion: (String(formData.get('cat_rotacion') ?? 'C') as CategoriaRotacion),
    stock_minimo_def: num(formData.get('stock_minimo_def')) ?? 0,
    precio_lista: num(formData.get('precio_lista')),
    proveedor_id: (String(formData.get('proveedor_id') ?? '') || null),
    ref: num(formData.get('ref')),
    codigo: num(formData.get('codigo')),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: producto, error } = await (supabase as any)
    .from('productos')
    .insert(insert)
    .select('id')
    .single()

  if (error) return { error: traducirError(error.message) }

  // Crea la fila de stock inicial (1:1 con producto)
  const stockInicial = num(formData.get('stock_inicial')) ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('stock').insert({
    producto_id: producto.id,
    cantidad_real: stockInicial,
    cantidad_disp: stockInicial,
  })

  revalidatePath('/productos')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
  redirect(`/productos/${producto.id}`)
}

function traducirError(msg: string): string {
  if (msg.includes('duplicate key') && msg.includes('ref')) return 'Ya existe un producto con esa REF.'
  if (msg.includes('duplicate key') && msg.includes('codigo')) return 'Ya existe un producto con ese código.'
  if (msg.includes('row-level security')) return 'No tienes permisos para crear productos (requiere rol Admin).'
  return 'No se pudo crear el producto: ' + msg
}
