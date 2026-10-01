'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import type { FilaArchivo } from '@/lib/inventario-fisico'

export interface ResultadoCarga {
  ok?: boolean
  id?: string
  error?: string
}

/**
 * Aplica un conteo físico: stock = lo contado (con AJUSTE en movimientos),
 * productos nuevos, etiqueta de no hallados y foto para las comparativas.
 * Todo lo hace la función `aplicar_inventario_fisico` en una transacción.
 */
export async function aplicarInventarioFisico(input: {
  periodo: string
  fechaCorte: string
  archivo: string
  observacion?: string
  items: FilaArchivo[]
}): Promise<ResultadoCarga> {
  const falta = await faltaPermiso('cargar_inventario_fisico')
  if (falta) return { error: falta }

  if (!input.periodo.trim()) return { error: 'Indica el periodo del inventario.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fechaCorte)) return { error: 'La fecha de corte no es válida.' }
  if (!input.items.length) return { error: 'El archivo no trae productos.' }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('aplicar_inventario_fisico', {
    p_periodo: input.periodo,
    p_fecha_corte: input.fechaCorte,
    p_archivo: input.archivo,
    p_items: input.items,
    p_observacion: input.observacion?.trim() || null,
  })
  if (error) return { error: error.message }

  revalidatePath('/inventario-fisico')
  revalidatePath(`/inventario-fisico/${data}`)
  revalidatePath('/arqueo')
  revalidatePath('/arqueo/analisis')
  revalidatePath('/productos')
  revalidatePath('/stock')
  return { ok: true, id: data as string }
}
