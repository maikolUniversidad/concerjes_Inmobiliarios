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

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Roles y Permisos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Define roles personalizados y configura sus permisos de acceso
        </p>
      </div>
      <RolesClient roles={roles ?? []} />
    </div>
  )
}
