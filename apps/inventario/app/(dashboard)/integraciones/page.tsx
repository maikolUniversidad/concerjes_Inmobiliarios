import type { Metadata } from 'next'
import Link from 'next/link'
import { Plug, Mail, MessageCircle, Webhook, Slack, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'

export const metadata: Metadata = { title: 'Integraciones' }
export const revalidate = 0

export default async function IntegracionesPage() {
  await requirePermiso('gestionar_integraciones')
  const supabase = await createClient()
  const { data: correo } = await supabase
    .from('integraciones_correo')
    .select('id, from_email, estado, envio_activo, recepcion_activa')
    .limit(1).maybeSingle()

  const c = correo as unknown as { from_email: string | null; estado: string; envio_activo: boolean; recepcion_activa: boolean } | null
  const correoConfig = !!c?.from_email

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <Plug className="w-6 h-6 text-brand-green" /> Integraciones
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Conecta servicios externos. Vincula tu correo para enviar y recibir emails desde cualquier plataforma.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Correo — activo */}
        <Link href="/integraciones/correo"
          className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:border-brand-green/40 hover:shadow transition-all group">
          <div className="flex items-start justify-between gap-3">
            <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-brand-green" />
            </div>
            <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-green transition-colors" />
          </div>
          <h3 className="font-heading font-bold text-base text-gray-900 mt-3">Correo electrónico</h3>
          <p className="font-body text-sm text-gray-500 mt-0.5">SMTP + IMAP · enviar y recibir de cualquier plataforma (Gmail, Outlook, dominio propio).</p>
          <div className="mt-3">
            {correoConfig ? (
              <span className={`inline-flex items-center gap-1 font-body text-xs px-2 py-0.5 rounded-full ${c!.estado === 'OK' ? 'bg-green-50 text-green-700' : c!.estado === 'ERROR' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                {c!.estado === 'OK' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {c!.from_email} · {c!.estado === 'OK' ? 'Conectado' : c!.estado === 'ERROR' ? 'Error' : 'Sin probar'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-body text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Sin configurar</span>
            )}
          </div>
        </Link>

        {/* Próximamente */}
        {[
          { icon: MessageCircle, label: 'WhatsApp', desc: 'Enviar alertas y mensajes por WhatsApp Business.' },
          { icon: Slack, label: 'Slack', desc: 'Notificaciones del sistema en tus canales.' },
          { icon: Webhook, label: 'Webhooks / API', desc: 'Conecta con otras plataformas vía webhooks.' },
        ].map(x => (
          <div key={x.label} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm opacity-70">
            <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center">
              <x.icon className="w-5 h-5 text-gray-400" />
            </div>
            <h3 className="font-heading font-bold text-base text-gray-900 mt-3">{x.label}</h3>
            <p className="font-body text-sm text-gray-500 mt-0.5">{x.desc}</p>
            <span className="inline-block mt-3 font-body text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Próximamente</span>
          </div>
        ))}
      </div>
    </div>
  )
}
