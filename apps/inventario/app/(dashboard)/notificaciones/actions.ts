'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import type { RolUsuario, SeveridadNotificacion, TipoNotificacion } from '@/lib/types/database'

export interface ActionResult { error?: string; ok?: boolean }

const ROLES: RolUsuario[] = [
  'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORDINADOR_COMPRAS',
  'BODEGUERO', 'AUDITOR', 'OPERADOR_SEDE',
]
const SEVERIDADES: SeveridadNotificacion[] = ['INFO', 'EXITO', 'ADVERTENCIA', 'CRITICA']

/** Actualiza una regla de alerta (solo admin, garantizado por RLS). */
export async function guardarRegla(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Regla inválida.' }

  const severidad = String(formData.get('severidad') ?? 'INFO') as SeveridadNotificacion
  if (!SEVERIDADES.includes(severidad)) return { error: 'Severidad inválida.' }

  const roles = formData.getAll('roles_destino').map(String).filter((r): r is RolUsuario => ROLES.includes(r as RolUsuario))

  const diasAviso = formData.get('dias_aviso')
  const umbral: Record<string, unknown> = {}
  if (diasAviso !== null && String(diasAviso).trim() !== '') {
    const n = Number(diasAviso)
    if (Number.isFinite(n) && n >= 0) umbral.dias_aviso = n
  }

  const { error } = await supabase
    .from('reglas_alerta')
    .update({
      activa: formData.get('activa') === 'on',
      canal_app: formData.get('canal_app') === 'on',
      canal_email: formData.get('canal_email') === 'on',
      severidad,
      roles_destino: roles,
      umbral,
    })
    .eq('id', id)

  if (error) {
    if (error.message.includes('row-level security') || error.message.includes('permission'))
      return { error: 'No tienes permisos para configurar alertas.' }
    return { error: 'No se pudo guardar la regla: ' + error.message }
  }

  await logActivity(supabase, {
    accion: 'UPDATE',
    modulo: 'Sistema',
    descripcion: `Configuró la alerta ${String(formData.get('codigo') ?? id)}`,
    entidad: 'ReglaAlerta',
    entidad_id: id,
    detalle: { severidad, roles_destino: roles, umbral },
  })

  revalidatePath('/configuracion/alertas')
  return { ok: true }
}

/** Guarda las preferencias de notificación del usuario actual. */
export async function guardarPreferencias(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const silenciados = formData.getAll('silenciados').map(String) as TipoNotificacion[]

  const { error } = await supabase
    .from('notificaciones_preferencias')
    .upsert({
      usuario_id: user.id,
      tipos_silenciados: silenciados,
      email_activo: formData.get('email_activo') === 'on',
    })

  if (error) return { error: 'No se pudieron guardar las preferencias: ' + error.message }

  revalidatePath('/configuracion/alertas')
  return { ok: true }
}

/** Envía un anuncio manual (regla SISTEMA) a los roles configurados. */
export async function enviarAnuncio(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const titulo = String(formData.get('titulo') ?? '').trim()
  const mensaje = String(formData.get('mensaje') ?? '').trim() || null
  if (titulo.length < 3) return { error: 'El título debe tener al menos 3 caracteres.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('emitir_notificacion', {
    p_codigo: 'SISTEMA',
    p_titulo: titulo,
    p_descripcion: mensaje,
    p_enlace: '/notificaciones',
  })

  if (error) return { error: 'No se pudo enviar el anuncio: ' + error.message }

  await logActivity(supabase, {
    accion: 'CREATE',
    modulo: 'Sistema',
    descripcion: `Envió un anuncio: ${titulo}`,
    entidad: 'Notificacion',
  })

  revalidatePath('/configuracion/alertas')
  return { ok: true }
}
