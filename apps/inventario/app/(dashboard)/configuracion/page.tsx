import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, User, Shield, Mail, Bell, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { ROL_LABELS, type RolUsuario } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Configuración' }

export default async function ConfiguracionPage() {
  await requirePermiso('ver_configuracion')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  type Perfil = { nombre: string; email: string; rol: RolUsuario }
  let perfil: Perfil | null = null
  if (user) {
    const { data } = await supabase.from('usuarios').select('nombre, email, rol').eq('id', user.id).single()
    perfil = (data as unknown as Perfil | null)
  }

  const empresa = [
    { label: 'Razón social', value: 'Conserjes Inmobiliarios Ltda' },
    { label: 'NIT', value: '800093388-2' },
    { label: 'Teléfono', value: '+57 320 808 1399' },
    { label: 'Sitio web', value: 'conserjesinmobiliarios.com' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Configuración</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Tu perfil y datos de la organización</p>
      </div>

      {/* Perfil */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-lg text-gray-900">Mi perfil</h2>
        </div>
        {perfil ? (
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-green to-brand-green-dark flex items-center justify-center text-white font-heading font-bold text-lg">
              {perfil.nombre.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="space-y-1">
              <p className="font-heading font-bold text-base text-gray-900">{perfil.nombre}</p>
              <p className="flex items-center gap-1.5 font-body text-sm text-gray-500"><Mail className="w-3.5 h-3.5" /> {perfil.email}</p>
              <span className={`inline-flex items-center gap-1 font-body text-xs px-2 py-0.5 rounded-full ${ROL_LABELS[perfil.rol].color}`}>
                <Shield className="w-3 h-3" /> {ROL_LABELS[perfil.rol].label}
              </span>
            </div>
          </div>
        ) : (
          <p className="font-body text-sm text-gray-400">No se pudo cargar el perfil.</p>
        )}
      </div>

      {/* Módulos de configuración */}
      <Link
        href="/configuracion/alertas"
        className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:border-brand-green/40 hover:shadow transition-all group"
      >
        <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5 text-brand-green" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-heading font-semibold text-base text-gray-900">Alertas y Notificaciones</h2>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Define qué alertas existen, su severidad, a qué roles avisan y tus preferencias.
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-green transition-colors" />
      </Link>

      {/* Empresa */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-lg text-gray-900">Organización</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {empresa.map(e => (
            <div key={e.label} className="border border-gray-100 rounded-xl p-3">
              <p className="font-body text-xs text-gray-400">{e.label}</p>
              <p className="font-body font-medium text-sm text-gray-900 mt-0.5">{e.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
