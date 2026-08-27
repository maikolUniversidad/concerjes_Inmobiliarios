'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Bell, Receipt, CheckCircle2, XCircle, Sparkles, CheckCheck } from 'lucide-react'
import { getPortalSupabase } from '@/lib/supabase/portal'
import { usePortal } from '../_portal/PortalProvider'
import { fmtFechaHora } from '../_portal/datos'

interface Aviso {
  id: string; tipo: string; titulo: string; mensaje: string | null
  enlace: string | null; leida: boolean; created_at: string
}

const ICONO: Record<string, { icon: React.ElementType; cls: string }> = {
  COBRO_EMITIDO:   { icon: Receipt,     cls: 'bg-amber-50 text-amber-600' },
  PAGO_VERIFICADO: { icon: CheckCircle2, cls: 'bg-green-50 text-brand-green' },
  PAGO_RECHAZADO:  { icon: XCircle,     cls: 'bg-red-50 text-red-600' },
  SERVICIO:        { icon: Sparkles,    cls: 'bg-blue-50 text-blue-600' },
  SISTEMA:         { icon: Bell,        cls: 'bg-gray-100 text-gray-500' },
}

export default function NotificacionesPage() {
  const { session } = usePortal()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const sb = getPortalSupabase()
    const { data } = await sb
      .from('notificaciones_cliente')
      .select('*')
      .eq('cliente_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setAvisos((data as unknown as Aviso[]) ?? [])
    setCargando(false)
  }, [session.user.id])

  useEffect(() => { cargar() }, [cargar])

  async function marcarLeida(id: string) {
    const sb = getPortalSupabase()
    await sb.from('notificaciones_cliente').update({ leida: true }).eq('id', id)
    setAvisos((prev) => prev.map((a) => (a.id === id ? { ...a, leida: true } : a)))
  }

  async function marcarTodas() {
    const sb = getPortalSupabase()
    await sb.from('notificaciones_cliente').update({ leida: true })
      .eq('cliente_id', session.user.id).eq('leida', false)
    setAvisos((prev) => prev.map((a) => ({ ...a, leida: true })))
  }

  const sinLeer = avisos.filter((a) => !a.leida).length

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900">Avisos</h1>
          <p className="mt-1 text-gray-500">
            {sinLeer > 0 ? `Tienes ${sinLeer} aviso${sinLeer === 1 ? '' : 's'} sin leer.` : 'Estás al día.'}
          </p>
        </div>
        {sinLeer > 0 && (
          <button onClick={marcarTodas} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            <CheckCheck className="h-4 w-4" /> Marcar todo leído
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
      ) : avisos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <Bell className="mx-auto h-8 w-8 text-brand-green" />
          <p className="mt-3 font-heading text-lg font-bold text-gray-900">Sin avisos por ahora</p>
          <p className="mt-1 text-sm text-gray-500">Aquí te avisamos de tus cuentas de cobro y pagos.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {avisos.map((a) => {
            const meta = ICONO[a.tipo] ?? ICONO.SISTEMA
            const Icon = meta.icon
            const contenido = (
              <>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.cls}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${a.leida ? 'font-semibold text-gray-700' : 'font-bold text-gray-900'}`}>{a.titulo}</p>
                  {a.mensaje && <p className="mt-0.5 text-sm text-gray-500">{a.mensaje}</p>}
                  <p className="mt-1 text-xs text-gray-400">{fmtFechaHora(a.created_at)}</p>
                </div>
                {!a.leida && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-green" />}
              </>
            )
            const clases = `flex gap-3.5 rounded-2xl border p-4 text-left transition-colors ${
              a.leida ? 'border-gray-200 bg-white' : 'border-brand-green/30 bg-brand-green/5'
            }`
            return a.enlace ? (
              <Link key={a.id} href={a.enlace} onClick={() => marcarLeida(a.id)} className={`${clases} hover:border-brand-green/50`}>
                {contenido}
              </Link>
            ) : (
              <button key={a.id} onClick={() => marcarLeida(a.id)} className={`${clases} w-full`}>
                {contenido}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
