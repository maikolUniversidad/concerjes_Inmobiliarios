import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import RolesClient from './RolesClient'

export const metadata: Metadata = { title: 'Roles y Permisos' }
export const revalidate = 0

export default async function RolesPage() {
  const supabase = await createClient()

  const { data: roles } = await supabase
    .from('roles')
    .select('*')
    .order('created_at', { ascending: true })

  // Conteo de usuarios por rol (para mostrar cuántos usan cada rol)
  const { data: usuariosRol } = await supabase.from('usuarios').select('rol_id')
  const conteos: Record<string, number> = {}
  for (const u of (usuariosRol ?? []) as { rol_id: string | null }[]) {
    if (u.rol_id) conteos[u.rol_id] = (conteos[u.rol_id] ?? 0) + 1
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Roles y Permisos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Define roles personalizados y configura sus permisos de acceso
        </p>
      </div>
      <RolesClient roles={roles ?? []} conteos={conteos} />
    </div>
  )
}
