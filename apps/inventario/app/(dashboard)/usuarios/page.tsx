import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import UsuariosClient from './UsuariosClient'

export const metadata: Metadata = { title: 'Usuarios' }
export const revalidate = 0

export default async function UsuariosPage() {
  const supabase = await createClient()

  const { data: usuarios } = await supabase
    .from('usuarios')
    .select(`
      id,
      nombre,
      email,
      rol,
      grupo_id,
      sede_id,
      activo,
      ultimo_acceso,
      created_at,
      avatar_url,
      telefono,
      permisos,
      grupos_contrato (
        id,
        codigo,
        nombre
      )
    `)
    .order('created_at', { ascending: false })

  const { data: grupos } = await supabase
    .from('grupos_contrato')
    .select('id, codigo, nombre')
    .order('nombre')

  const { data: sedes } = await supabase
    .from('sedes')
    .select('id, grupo_id, nombre')
    .order('nombre')

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Usuarios y Roles</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {(usuarios ?? []).filter((u: { activo: boolean }) => u.activo).length} activos · {(usuarios ?? []).length} total
        </p>
      </div>
      <UsuariosClient
        usuarios={usuarios ?? []}
        grupos={grupos ?? []}
        sedes={sedes ?? []}
      />
    </div>
  )
}
