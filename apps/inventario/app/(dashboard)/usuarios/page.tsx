import type { Metadata } from 'next'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { GrupoContrato, RolUsuario } from '@/lib/types/database'
import { UsuariosClient, type UsuarioRow } from './UsuariosClient'

export const metadata: Metadata = { title: 'Usuarios' }
export const revalidate = 30

interface Raw {
  id: string
  nombre: string
  email: string
  rol: RolUsuario
  activo: boolean
  ultimo_acceso: string | null
  grupo: { codigo: GrupoContrato } | null
}

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, email, rol, activo, ultimo_acceso, grupo:grupos_contrato ( codigo )')
    .order('created_at', { ascending: true })

  const usuarios: UsuarioRow[] = ((data as unknown as Raw[]) ?? []).map(u => ({
    id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo,
    ultimo_acceso: u.ultimo_acceso, grupo_codigo: u.grupo?.codigo ?? null,
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Usuarios y Roles</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {usuarios.filter(u => u.activo).length} activos · {usuarios.length} total
          </p>
        </div>
        <button className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm opacity-60 cursor-not-allowed" title="Invitación de usuarios — próximamente">
          <Plus className="w-4 h-4" /> Invitar usuario
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando usuarios: {error.message}
        </div>
      ) : usuarios.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-heading font-bold text-lg">Aún no hay usuarios registrados</p>
          <p className="font-body text-sm mt-1">
            Los usuarios se crean automáticamente al registrarse en Supabase Auth.
          </p>
        </div>
      ) : (
        <UsuariosClient usuarios={usuarios} />
      )}
    </div>
  )
}
