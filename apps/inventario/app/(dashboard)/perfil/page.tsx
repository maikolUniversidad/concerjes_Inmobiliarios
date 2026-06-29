import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PerfilClient } from './PerfilClient'

export const metadata: Metadata = { title: 'Mi Perfil' }
export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase
    .from('usuarios')
    .select(`
      id, nombre, email, rol, telefono, avatar_url, activo,
      ultimo_acceso, created_at,
      grupos_contrato ( codigo, nombre ),
      sedes ( nombre )
    `)
    .eq('id', user.id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (perfil ?? {}) as any

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Mi Perfil</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Actualiza tu foto y tus datos personales
        </p>
      </div>

      <PerfilClient
        usuario={{
          id: user.id,
          nombre: p.nombre ?? '',
          email: p.email ?? user.email ?? '',
          rol: p.rol ?? 'AUDITOR',
          telefono: p.telefono ?? '',
          avatar_url: p.avatar_url ?? null,
          created_at: p.created_at ?? null,
          ultimo_acceso: p.ultimo_acceso ?? null,
          grupo: p.grupos_contrato?.nombre ?? null,
          sede: p.sedes?.nombre ?? null,
        }}
      />
    </div>
  )
}
