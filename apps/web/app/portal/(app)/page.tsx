'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, ClipboardList, CalendarDays, ArrowRight, Clock, MapPin, Loader2, Sparkles, Wallet } from 'lucide-react'
import { getPortalSupabase } from '@/lib/supabase/portal'
import { usePortal } from './_portal/PortalProvider'
import { ESTADOS, ICONO_SERVICIO, fmtFechaCorta, fmtHora, fmtMoneda } from './_portal/datos'

interface Solicitud {
  id: string; numero: string; estado: string
  cliente_direccion: string; cliente_barrio: string | null
  fecha_deseada: string; hora_inicio: string
  tipos_servicio_hogar: { nombre: string } | null
}

export default function PortalInicioPage() {
  const { cliente, session } = usePortal()
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [porPagar, setPorPagar] = useState<{ cuentas: number; saldo: number }>({ cuentas: 0, saldo: 0 })

  useEffect(() => {
    const sb = getPortalSupabase()
    sb.from('cobros_servicio_hogar')
      .select('saldo')
      .eq('cliente_id', session.user.id)
      .in('estado', ['EMITIDO', 'PARCIAL'])
      .then(({ data }) => {
        const filas = (data as { saldo: number }[]) ?? []
        setPorPagar({
          cuentas: filas.length,
          saldo: filas.reduce((a, c) => a + Number(c.saldo ?? 0), 0),
        })
      })

    sb.from('solicitudes_servicio_hogar')
      .select('id, numero, estado, cliente_direccion, cliente_barrio, fecha_deseada, hora_inicio, tipos_servicio_hogar(nombre)')
      .eq('cliente_id', session.user.id)
      .order('fecha_deseada', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setSolicitudes((data as unknown as Solicitud[]) ?? [])
        setCargando(false)
      })
  }, [session.user.id])

  const nombre = cliente?.nombre && cliente.nombre !== 'Cliente' ? cliente.nombre.split(' ')[0] : ''
  const activos = solicitudes.filter((s) => ['PENDIENTE', 'CONFIRMADA', 'EN_SERVICIO'].includes(s.estado))
  const proximos = activos
    .filter((s) => s.fecha_deseada >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.fecha_deseada.localeCompare(b.fecha_deseada))
  const proximo = proximos[0]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-gray-900 sm:text-3xl">
          Hola{nombre ? `, ${nombre}` : ''} 👋
        </h1>
        <p className="mt-1 text-gray-500">Este es el estado de tus servicios del hogar.</p>
      </div>

      {/* Próximo servicio destacado */}
      {proximo ? (
        <div className="overflow-hidden rounded-2xl gradient-brand text-white shadow-lg">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="text-4xl">{ICONO_SERVICIO[proximo.tipos_servicio_hogar?.nombre ?? ''] ?? '🧹'}</span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Tu próximo servicio</p>
                <p className="font-heading text-xl font-bold">{proximo.tipos_servicio_hogar?.nombre ?? 'Servicio'}</p>
                <p className="mt-1 flex items-center gap-3 text-sm text-white/80">
                  <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {fmtFechaCorta(proximo.fecha_deseada)}</span>
                  <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {fmtHora(proximo.hora_inicio)}</span>
                </p>
              </div>
            </div>
            <Link href="/portal/servicios" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-brand-green hover:bg-green-50">
              Ver seguimiento <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-brand-green" />
          <p className="mt-3 font-heading text-lg font-bold text-gray-900">Aún no tienes servicios programados</p>
          <p className="mt-1 text-sm text-gray-500">Agenda tu primer servicio del hogar en minutos.</p>
          <Link href="/portal/solicitar" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
            <CalendarPlus className="h-4 w-4" /> Agendar servicio
          </Link>
        </div>
      )}

      {/* Saldo pendiente */}
      {porPagar.cuentas > 0 && (
        <Link href="/portal/pagos" className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 transition-colors hover:border-amber-300">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-heading font-bold text-gray-900">Tienes {fmtMoneda(porPagar.saldo)} por pagar</p>
            <p className="text-sm text-gray-600">
              {porPagar.cuentas} cuenta{porPagar.cuentas === 1 ? '' : 's'} de cobro pendiente{porPagar.cuentas === 1 ? '' : 's'}.
            </p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-amber-600" />
        </Link>
      )}

      {/* Accesos rápidos */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Accion href="/portal/solicitar" icon={<CalendarPlus className="h-5 w-5" />} titulo="Agendar servicio" desc="Solicita un nuevo servicio" />
        <Accion href="/portal/servicios" icon={<ClipboardList className="h-5 w-5" />} titulo="Mis servicios" desc={`${activos.length} activo${activos.length === 1 ? '' : 's'}`} />
        <Accion href="/portal/pagos" icon={<Wallet className="h-5 w-5" />} titulo="Mis pagos" desc={porPagar.cuentas > 0 ? `${fmtMoneda(porPagar.saldo)} pendiente` : 'Estás al día'} />
        <Accion href="/portal/agenda" icon={<CalendarDays className="h-5 w-5" />} titulo="Disponibilidad" desc="Consulta horarios libres" />
      </div>

      {/* Servicios recientes */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-gray-900">Servicios recientes</h2>
          <Link href="/portal/servicios" className="text-sm font-semibold text-brand-green hover:underline">Ver todos</Link>
        </div>
        {cargando ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>
        ) : solicitudes.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Todavía no has solicitado servicios.</p>
        ) : (
          <div className="space-y-2.5">
            {solicitudes.slice(0, 4).map((s) => {
              const est = ESTADOS[s.estado] ?? ESTADOS.PENDIENTE
              return (
                <Link key={s.id} href="/portal/servicios" className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-brand-green/40 hover:bg-brand-green/5">
                  <span className="text-2xl">{ICONO_SERVICIO[s.tipos_servicio_hogar?.nombre ?? ''] ?? '🧹'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{s.tipos_servicio_hogar?.nombre ?? 'Servicio'}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-gray-400"><MapPin className="h-3 w-3 shrink-0" /> {s.cliente_barrio || s.cliente_direccion}</p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${est.bg} ${est.texto}`}>{est.label}</span>
                    <p className="mt-1 text-xs text-gray-400">{fmtFechaCorta(s.fecha_deseada)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Accion({ href, icon, titulo, desc }: { href: string; icon: React.ReactNode; titulo: string; desc: string }) {
  return (
    <Link href={href} className="group rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:border-brand-green/40 hover:shadow-md">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green transition-colors group-hover:bg-brand-green group-hover:text-white">
        {icon}
      </div>
      <p className="mt-3 font-heading font-bold text-gray-900">{titulo}</p>
      <p className="text-sm text-gray-500">{desc}</p>
    </Link>
  )
}
