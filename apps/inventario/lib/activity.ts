import { SupabaseClient } from '@supabase/supabase-js'

export async function logActivity(
  supabase: SupabaseClient,
  params: {
    accion: string
    modulo: string
    descripcion: string
    entidad?: string
    entidad_id?: string
    detalle?: object
  }
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await supabase.from('actividad_log').insert({
      usuario_id: user?.id ?? null,
      usuario_email: user?.email ?? null,
      usuario_nombre: user?.user_metadata?.nombre ?? user?.email ?? null,
      accion: params.accion,
      modulo: params.modulo,
      descripcion: params.descripcion,
      entidad: params.entidad ?? null,
      entidad_id: params.entidad_id ?? null,
      detalle: params.detalle ?? null,
    })
  } catch (e) {
    console.error('logActivity error', e)
  }
}
