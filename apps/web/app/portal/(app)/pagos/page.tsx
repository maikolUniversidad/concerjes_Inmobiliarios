'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Receipt, ArrowRight, AlertTriangle, CheckCircle2, Wallet } from 'lucide-react'
import { getPortalSupabase } from '@/lib/supabase/portal'
import { usePortal } from '../_portal/PortalProvider'
import { ESTADOS_COBRO, estadoCobro, fmtMoneda, fmtFecha } from '../_portal/datos'

interface Cobro {
  id: string
  numero: string
  concepto: string
  tipo: string
  total: number
  pagado: number
  saldo: number
  estado: string
  fecha_emision: string | null
  fecha_vencimiento: string | null
  solicitudes_servicio_hogar: { numero: string; tipos_servicio_hogar: { nombre: string } | null } | null
}

export default function PagosPage() {
  const { session } = usePortal()
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<'pendientes' | 'todos'>('pendientes')

  useEffect(() => {
    const sb = getPortalSupabase()
    sb.from('cobros_servicio_hogar')
      .select('id, numero, concepto, tipo, total, pagado, saldo, estado, fecha_emision, fecha_vencimiento, solicitudes_servicio_hogar(numero, tipos_servicio_hogar(nombre))')
      .eq('cliente_id', session.user.id)
      .neq('estado', 'BORRADOR')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCobros((data as unknown as Cobro[]) ?? [])
        setCargando(false)
      })
  }, [session.user.id])

  const pendientes = cobros.filter((c) => ['EMITIDO', 'PARCIAL'].includes(c.estado))
  const totalPendiente = pendientes.reduce((a, c) => a + Number(c.saldo ?? 0), 0)
  const vencidos = pendientes.filter((c) => estadoCobro(c.estado, c.fecha_vencimiento, Number(c.saldo)) === 'VENCIDO')
  const visibles = filtro === 'pendientes' ? pendientes : cobros

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">Mis pagos</h1>
        <p className="mt-1 text-gray-500">Cuentas de cobro de tus servicios y su estado.</p>
      </div>

      {/* Resumen */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-2xl p-5 ${totalPendiente > 0 ? 'gradient-brand text-white' : 'border border-gray-200 bg-white'}`}>
          <p className={`text-xs font-semibold uppercase tracking-wide ${totalPendiente > 0 ? 'text-white/70' : 'text-gray-400'}`}>
            Saldo pendiente
          </p>
          <p className={`mt-1 font-heading text-3xl font-bold ${totalPendiente > 0 ? 'text-white' : 'text-gray-900'}`}>
            {fmtMoneda(totalPendiente)}
          </p>
          <p className={`mt-1 text-sm ${totalPendiente > 0 ? 'text-white/80' : 'text-gray-500'}`}>
            {pendientes.length === 0
              ? 'No tienes cobros pendientes.'
              : `${pendientes.length} cuenta${pendientes.length === 1 ? '' : 's'} por pagar`}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          {vencidos.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wide">Vencidos</p>
              </div>
              <p className="mt-1 font-heading text-3xl font-bold text-red-600">{vencidos.length}</p>
              <p className="mt-1 text-sm text-gray-500">Ponte al día para no afectar tu servicio.</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-brand-green">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wide">Al día</p>
              </div>
              <p className="mt-1 font-heading text-lg font-bold text-gray-900">Sin cobros vencidos</p>
              <p className="mt-1 text-sm text-gray-500">Gracias por mantener tus pagos al día.</p>
            </>
          )}
        </div>
      </div>

      <div className="flex rounded-xl bg-gray-100 p-1">
        {(['pendientes', 'todos'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
              filtro === f ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'
            }`}
          >
            {f === 'pendientes' ? 'Por pagar' : 'Historial'}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <Wallet className="mx-auto h-8 w-8 text-brand-green" />
          <p className="mt-3 font-heading text-lg font-bold text-gray-900">
            {filtro === 'pendientes' ? 'No tienes cobros pendientes' : 'Aún no tienes cobros'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Cuando confirmemos un servicio te enviaremos aquí la cuenta de cobro.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibles.map((c) => {
            const est = estadoCobro(c.estado, c.fecha_vencimiento, Number(c.saldo))
            const badge = ESTADOS_COBRO[est] ?? ESTADOS_COBRO.EMITIDO
            return (
              <Link
                key={c.id}
                href={`/portal/pagos/${c.id}`}
                className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-brand-green/40 hover:bg-brand-green/5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
                  <Receipt className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-heading font-bold text-gray-900">{c.concepto}</p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.bg} ${badge.texto}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">
                    {c.numero}
                    {c.solicitudes_servicio_hogar?.tipos_servicio_hogar?.nombre
                      ? ` · ${c.solicitudes_servicio_hogar.tipos_servicio_hogar.nombre}`
                      : ''}
                    {c.fecha_vencimiento ? ` · vence ${fmtFecha(c.fecha_vencimiento).replace(/,.*/, '')}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-heading font-bold text-gray-900">{fmtMoneda(Number(c.saldo) > 0 ? c.saldo : c.total)}</p>
                  <p className="text-xs text-gray-400">{Number(c.saldo) > 0 ? 'saldo' : 'total'}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-gray-300" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
