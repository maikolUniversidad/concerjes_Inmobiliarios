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

function leerCampos(formData: FormData) {
  return {
    nombre_estandar: String(formData.get('nombre_estandar') ?? '').trim(),
    presentacion: String(formData.get('presentacion') ?? '').trim() || null,
    tipo_insumo: String(formData.get('tipo_insumo') ?? 'OTROS') as TipoInsumo,
    cat_rotacion: String(formData.get('cat_rotacion') ?? 'C') as CategoriaRotacion,
    stock_minimo_def: num(formData.get('stock_minimo_def')) ?? 0,
    precio_lista: num(formData.get('precio_lista')),
    proveedor_id: String(formData.get('proveedor_id') ?? '') || null,
    ref: num(formData.get('ref')),
    codigo: num(formData.get('codigo')),
    complemento: String(formData.get('complemento') ?? '').trim() || null,
    imagen_url: String(formData.get('imagen_url') ?? '').trim() || null,
    fotos_extra: formData.getAll('foto_extra').map(v => String(v)).filter(Boolean),
    sku: String(formData.get('sku') ?? '').trim() || null,
    ubicacion_bodega: (() => {
      const pasillo = String(formData.get('ubicacion_pasillo') ?? '').trim().toUpperCase()
      const estante = String(formData.get('ubicacion_estante') ?? '').trim()
      const nivel   = String(formData.get('ubicacion_nivel') ?? '').trim()
      if (!pasillo && !estante && !nivel) return null
      return [pasillo, estante, nivel].filter(Boolean).join('-')
    })(),
    bodega_descripcion: String(formData.get('bodega_descripcion') ?? '').trim() || null,
  }
}

function traducirError(msg: string): string {
  if (msg.includes('duplicate key') && msg.includes('ref')) return 'Ya existe un producto con esa REF.'
  if (msg.includes('duplicate key') && msg.includes('codigo')) return 'Ya existe un producto con ese código.'
  if (msg.includes('row-level security')) return 'No tienes permisos para esta acción (requiere rol Admin).'
  return 'Operación fallida: ' + msg
}

export async function crearProducto(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { fotos_extra, ...camposSinFotos } = leerCampos(formData)
  if (camposSinFotos.nombre_estandar.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: producto, error } = await (supabase as any)
    .from('productos').insert(camposSinFotos).select('id').single()

  if (error) return { error: traducirError(error.message) }

  const stockInicial = num(formData.get('stock_inicial')) ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('stock').insert({
    producto_id: producto.id, cantidad_real: stockInicial, cantidad_disp: stockInicial,
  })

  // Registrar foto principal + fotos extra en producto_fotos
  const todasFotos = [
    ...(camposSinFotos.imagen_url ? [{ url: camposSinFotos.imagen_url, es_principal: true, orden: 0 }] : []),
    ...(fotos_extra ?? []).map((url, i) => ({ url, es_principal: false, orden: i + 1 })),
  ]
  if (todasFotos.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('producto_fotos').insert(
      todasFotos.map(f => ({ ...f, producto_id: producto.id }))
    )
  }

  revalidatePath('/productos'); revalidatePath('/stock'); revalidatePath('/dashboard')
  redirect(`/productos/${producto.id}`)
}

export async function actualizarProducto(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Producto no especificado.' }
  const { fotos_extra, ...camposSinFotos } = leerCampos(formData)
  if (camposSinFotos.nombre_estandar.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('productos').update(camposSinFotos).eq('id', id)
  if (error) return { error: traducirError(error.message) }

  // Sincronizar fotos extra (upsert por URL — evita duplicados)
  if (fotos_extra && fotos_extra.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('producto_fotos').select('url').eq('producto_id', id)
    const existingUrls = new Set((existing ?? []).map((r: { url: string }) => r.url))
    const nuevas = fotos_extra.filter(url => !existingUrls.has(url))
    if (nuevas.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('producto_fotos').insert(
        nuevas.map((url, i) => ({ producto_id: id, url, es_principal: false, orden: (existing?.length ?? 0) + i + 1 }))
      )
    }
  }

  revalidatePath('/productos'); revalidatePath(`/productos/${id}`); revalidatePath('/stock'); revalidatePath('/dashboard')
  redirect(`/productos/${id}`)
}

export async function eliminarProducto(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return

  // Soft delete: conserva trazabilidad e integridad con movimientos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('productos').update({ activo: false }).eq('id', id)
  revalidatePath('/productos'); revalidatePath('/stock'); revalidatePath('/dashboard')
  redirect('/productos')
}
