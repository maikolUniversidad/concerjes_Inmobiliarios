import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { ReglaAlerta, NotificacionPreferencias, RolUsuario } from '@/lib/types/database'
import { AlertasClient } from './AlertasClient'

export const metadata: Metadata = { title: 'Alertas y Notificaciones' }

export default async function ConfiguracionAlertasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let rol: RolUsuario | null = null
  let prefs: NotificacionPreferencias | null = null
  if (user) {
    const { data: perfil } = await supabase.from('usuarios').select('rol').eq('id', user.id).single()
    rol = (perfil as { rol: RolUsuario } | null)?.rol ?? null
    const { data: p } = await supabase
      .from('notificaciones_preferencias')
      .select('*')
      .eq('usuario_id', user.id)
      .maybeSingle()
    prefs = (p as NotificacionPreferencias | null)
  }

  const { data: reglas } = await supabase
    .from('reglas_alerta')
    .select('*')
    .order('codigo', { ascending: true })

  const esAdmin = rol === 'SUPER_ADMIN' || rol === 'ADMIN'

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <Link href="/configuracion" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Configuración
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Alertas y Notificaciones</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Catálogo de alertas del sistema, sus destinatarios y tus preferencias personales.
        </p>
      </div>

      <AlertasClient
        reglas={(reglas as ReglaAlerta[]) ?? []}
        prefs={prefs}
        esAdmin={esAdmin}
      />
    </div>
  )
}
