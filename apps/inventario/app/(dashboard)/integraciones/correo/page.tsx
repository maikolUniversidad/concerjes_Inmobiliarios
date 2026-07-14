import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { CorreoForm, type CorreoDefaults } from './CorreoForm'

export const metadata: Metadata = { title: 'Integración · Correo' }
export const revalidate = 0

export default async function CorreoIntegracionPage() {
  await requirePermiso('gestionar_integraciones')
  const supabase = await createClient()
  const [{ data }, { count: pendientes }] = await Promise.all([
    supabase.from('integraciones_correo').select('*').limit(1).maybeSingle(),
    supabase.from('correo_saliente').select('id', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = data as any

  // No enviamos las contraseñas al cliente: solo si existen.
  const defaults: CorreoDefaults = {
    nombre: c?.nombre ?? 'Correo principal',
    from_nombre: c?.from_nombre ?? '',
    from_email: c?.from_email ?? '',
    smtp_host: c?.smtp_host ?? '',
    smtp_port: c?.smtp_port ?? 587,
    smtp_secure: c?.smtp_secure ?? false,
    smtp_user: c?.smtp_user ?? '',
    envio_activo: c?.envio_activo ?? true,
    imap_host: c?.imap_host ?? '',
    imap_port: c?.imap_port ?? 993,
    imap_secure: c?.imap_secure ?? true,
    imap_user: c?.imap_user ?? '',
    recepcion_activa: c?.recepcion_activa ?? false,
    tieneSmtpPass: !!c?.smtp_pass,
    tieneImapPass: !!c?.imap_pass,
    estado: c?.estado ?? 'SIN_PROBAR',
    ultimo_test: c?.ultimo_test ?? null,
    ultimo_error: c?.ultimo_error ?? null,
    configurado: !!c?.from_email,
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <Link href="/integraciones" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Integraciones
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Integración de correo</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Vincula una cuenta de cualquier proveedor (Gmail, Outlook, dominio propio) por SMTP para enviar e IMAP para recibir.
        </p>
      </div>

      <CorreoForm defaults={defaults} pendientes={pendientes ?? 0} />
    </div>
  )
}
