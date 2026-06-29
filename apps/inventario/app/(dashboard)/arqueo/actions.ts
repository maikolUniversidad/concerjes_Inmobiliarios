'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

export interface ActionResult { error?: string }

export async function crearArqueo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (nombre.length < 3) return { error: 'El nombre del arqueo es obligatorio.' }
  const descripcion = String(formData.get('descripcion') ?? '').trim() || null
  const filtro = String(formData.get('filtro_tipo') ?? '') || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('crear_arqueo', {
    p_nombre: nombre, p_descripcion: descripcion, p_filtro: filtro,
  })
  if (error) {
    if (error.message.includes('permiso')) return { error: 'No tienes permisos para iniciar un arqueo (requiere Admin, Bodeguero o Supervisor).' }
    return { error: 'No se pudo crear el arqueo: ' + error.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await logActivity(supabase as any, {
    accion: 'CREAR', modulo: 'Arqueo', descripcion: `Arqueo iniciado: ${nombre}`,
    entidad: 'arqueos', entidad_id: data, detalle: { filtro },
  })

  revalidatePath('/arqueo')
  redirect(`/arqueo/${data}`)
}

export async function cerrarArqueo(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const id = String(formData.get('id') ?? '')
  if (!id) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('cerrar_arqueo', { p_arqueo: id })
  if (!error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await logActivity(supabase as any, {
      accion: 'CERRAR', modulo: 'Arqueo', descripcion: 'Arqueo cerrado y ajustes aplicados',
      entidad: 'arqueos', entidad_id: id,
    })
  }
  revalidatePath(`/arqueo/${id}`)
  revalidatePath('/arqueo')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
  revalidatePath('/historial')
  redirect(`/arqueo/${id}`)
}
