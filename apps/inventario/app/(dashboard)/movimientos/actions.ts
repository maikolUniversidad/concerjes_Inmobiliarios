'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { TipoMovimiento } from '@/lib/types/database'

export interface ActionResult { error?: string }

export async function registrarMovimiento(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const producto_id = String(formData.get('producto_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '') as TipoMovimiento
  const cantidad = Number(formData.get('cantidad'))
  const sede_id = String(formData.get('sede_id') ?? '') || null
  const observacion = String(formData.get('observacion') ?? '').trim() || null

  if (!producto_id) return { error: 'Selecciona un producto.' }
  if (!['ENTRADA', 'SALIDA', 'DEVOLUCION', 'AJUSTE', 'TRASLADO'].includes(tipo)) return { error: 'Tipo de movimiento inválido.' }
  if (!Number.isFinite(cantidad) || cantidad <= 0) return { error: 'La cantidad debe ser mayor que cero.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('registrar_movimiento', {
    p_producto: producto_id,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_sede: sede_id,
    p_observacion: observacion,
  })

  if (error) {
    if (error.message.includes('row-level security') || error.message.includes('permission'))
      return { error: 'No tienes permisos para registrar movimientos.' }
    return { error: 'No se pudo registrar el movimiento: ' + error.message }
  }

  revalidatePath('/movimientos')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
  redirect('/movimientos')
}
