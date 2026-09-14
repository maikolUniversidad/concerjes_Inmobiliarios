'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Inbox, Wrench, CheckCircle2, Siren, CalendarClock, Search, MessageSquare, ChevronRight,
  Loader2, CalendarPlus, MapPin, ScanLine,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ESTADO_MAQ_META } from '../maquinaria/estados'
import { CONDICION_META, ESTADO_TICKET_META, PRIORIDAD_META, TIPO_TICKET_META, haceCuanto } from '@/lib/mantenimiento'

export interface TicketFila {
  id: string; numero: string; tipo: string; prioridad: string; estado: string; titulo: string
  reportado_nombre: string | null; asignado_a: string | null; asignado_nombre: string | null
  created_at: string; recibido_at: string | null; resuelto_at: string | null; programado_para: string | null
  ultimo_mensaje_at: string | null; costo: number | null
  maquinaria: { id: string; codigo: string; nombre: string } | null
  sede: { id: string; nombre: string } | null
}
export interface EquipoAlerta {
  id: string; codigo: string; nombre: string; estado: string; condicion: string
  proximo_mant: string | null; sedes: { nombre: string } | null
}

type Vista = 'atender' | 'curso' | 'resueltos' | 'historial' | 'todos'
const VISTAS: { k: Vista; label: string; estados: string[] | null }[] = [
  { k: 'atender', label: 'Por recibir', estados: ['ABIERTO'] },
  { k: 'curso', label: 'En curso', estados: ['RECIBIDO', 'EN_PROCESO', 'EN_ESPERA'] },
  { k: 'resueltos', label: 'Por confirmar', estados: ['RESUELTO'] },
  { k: 'historial', label: 'Cerrados', estados: ['CERRADO', 'CANCELADO'] },
  { k: 'todos', label: 'Todos', estados: null },
]
const ACTIVOS = ['ABIERTO', 'RECIBIDO', 'EN_PROCESO', 'EN_ESPERA']

export function TableroClient({ tickets, equipos, usuarioId, permisos }: {
  tickets: TicketFila[]
  equipos: EquipoAlerta[]
  usuarioId: string
  permisos: { tecnico: boolean; jefe: boolean }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [vista, setVista] = useState<Vista>(tickets.some((t) => t.estado === 'ABIERTO') ? 'atender' : 'curso')
  const [mios, setMios] = useState(false)
  const [prioridad, setPrioridad] = useState('')
  const [sede, setSede] = useState('')
  const [q, setQ] = useState('')
  const [recibiendo, setRecibiendo] = useState<string | null>(null)

  // En vivo: cualquier cambio en tickets refresca el tablero (con un respiro).
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    const canal = sb.channel('mant-tablero')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mantenimiento_tickets' }, () => {
        if (tRef.current) clearTimeout(tRef.current)
        tRef.current = setTimeout(() => router.refresh(), 800)
      })
      .subscribe()
    return () => { if (tRef.current) clearTimeout(tRef.current); sb.removeChannel(canal) }
  }, [router])

  const sedes = useMemo(() => {
    const m = new Map<string, string>()
    tickets.forEach((t) => { if (t.sede) m.set(t.sede.id, t.sede.nombre) })
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [tickets])

  const kpi = useMemo(() => ({
    porRecibir: tickets.filter((t) => t.estado === 'ABIERTO').length,
    enCurso: tickets.filter((t) => ['RECIBIDO', 'EN_PROCESO', 'EN_ESPERA'].includes(t.estado)).length,
    criticos: tickets.filter((t) => ACTIVOS.includes(t.estado) && (t.prioridad === 'CRITICA' || t.prioridad === 'ALTA')).length,
    porConfirmar: tickets.filter((t) => t.estado === 'RESUELTO').length,
    fueraServicio: equipos.filter((e) => e.estado === 'DANADA' || e.estado === 'MANTENIMIENTO').length,
    preventivos: equipos.filter((e) => e.proximo_mant && new Date(e.proximo_mant + 'T00:00:00') <= new Date()).length,
  }), [tickets, equipos])

  const filtrados = useMemo(() => {
    const estados = VISTAS.find((v) => v.k === vista)?.estados
    const texto = q.trim().toLowerCase()
    return tickets
      .filter((t) => !estados || estados.includes(t.estado))
      .filter((t) => !mios || t.asignado_a === usuarioId)
      .filter((t) => !prioridad || t.prioridad === prioridad)
      .filter((t) => !sede || t.sede?.id === sede)
      .filter((t) => !texto || [t.numero, t.titulo, t.maquinaria?.codigo, t.maquinaria?.nombre, t.reportado_nombre, t.asignado_nombre]
        .some((x) => x?.toLowerCase().includes(texto)))
      .sort((a, b) => {
        if (vista === 'historial' || vista === 'todos') return b.created_at.localeCompare(a.created_at)
        const p = (PRIORIDAD_META[a.prioridad]?.orden ?? 9) - (PRIORIDAD_META[b.prioridad]?.orden ?? 9)
        return p !== 0 ? p : a.created_at.localeCompare(b.created_at)
      })
  }, [tickets, vista, mios, prioridad, sede, q, usuarioId])

  function recibir(id: string) {
    setRecibiendo(id)
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (createClient() as any).rpc('mant_transicion', { p_ticket: id, p_accion: 'RECIBIR' })
      setRecibiendo(null)
      if (error) { toast.error(error.message); return }
      toast.success('Ticket recibido y asignado a ti.')
      router.refresh()
    })
  }

  function generarPreventivos() {
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createClient() as any).rpc('mant_generar_preventivos', { p_dias: 7 })
      if (error) { toast.error(error.message); return }
      toast.success(data > 0 ? `${data} preventivo(s) programado(s).` : 'No hay preventivos pendientes por programar.')
      router.refresh()
    })
  }

  const Kpi = ({ icon: Icon, label, valor, cls, onClick }: { icon: typeof Inbox; label: string; valor: number; cls: string; onClick?: () => void }) => (
    <button onClick={onClick} disabled={!onClick}
      className="rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm enabled:hover:border-brand-green/40 disabled:cursor-default">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${cls}`}><Icon className="w-4 h-4" /></span>
      <p className="mt-2 font-heading text-2xl font-bold text-gray-900 tabular-nums">{valor}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </button>
  )

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi icon={Inbox} label="Por recibir" valor={kpi.porRecibir} cls="bg-red-50 text-red-600" onClick={() => setVista('atender')} />
        <Kpi icon={Wrench} label="En curso" valor={kpi.enCurso} cls="bg-amber-50 text-amber-600" onClick={() => setVista('curso')} />
        <Kpi icon={Siren} label="Alta / crítica activos" valor={kpi.criticos} cls="bg-orange-50 text-orange-600" />
        <Kpi icon={CheckCircle2} label="Por confirmar en sede" valor={kpi.porConfirmar} cls="bg-emerald-50 text-emerald-600" onClick={() => setVista('resueltos')} />
        <Kpi icon={AlertTriangle} label="Equipos fuera de servicio" valor={kpi.fueraServicio} cls="bg-gray-100 text-gray-600" />
        <Kpi icon={CalendarClock} label="Preventivos vencidos" valor={kpi.preventivos} cls="bg-purple-50 text-purple-600" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px] items-start">
        {/* Tickets */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden min-w-0">
          <div className="flex overflow-x-auto no-scrollbar border-b border-gray-100 text-sm">
            {VISTAS.map((v) => {
              const n = v.estados ? tickets.filter((t) => v.estados!.includes(t.estado)).length : tickets.length
              return (
                <button key={v.k} onClick={() => setVista(v.k)}
                  className={`shrink-0 px-4 py-3 font-medium ${vista === v.k ? 'text-brand-green border-b-2 border-brand-green' : 'text-gray-500 hover:text-gray-700'}`}>
                  {v.label} <span className="ml-1 text-xs text-gray-400">{n}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-50">
            <div className="flex flex-1 min-w-[180px] items-center gap-2 rounded-lg border border-gray-200 px-2.5">
              <Search className="w-4 h-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ticket, equipo o persona"
                className="flex-1 py-2 text-sm outline-none bg-transparent" />
            </div>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-2 text-sm" aria-label="Prioridad">
              <option value="">Toda prioridad</option>
              {Object.entries(PRIORIDAD_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            {sedes.length > 1 && (
              <select value={sede} onChange={(e) => setSede(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-2 text-sm max-w-[180px]" aria-label="Sede">
                <option value="">Todas las sedes</option>
                {sedes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            )}
            {permisos.tecnico && (
              <label className="flex items-center gap-1.5 text-sm text-gray-600 select-none">
                <input type="checkbox" checked={mios} onChange={(e) => setMios(e.target.checked)} className="accent-brand-green" /> Asignados a mí
              </label>
            )}
          </div>

          {filtrados.length === 0 ? (
            <p className="p-10 text-center text-sm text-gray-400">No hay tickets en esta vista.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {filtrados.map((t) => {
                const est = ESTADO_TICKET_META[t.estado]
                const pri = PRIORIDAD_META[t.prioridad]
                return (
                  <li key={t.id} className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-gray-50/70">
                    <span className={`h-10 w-1 rounded-full shrink-0 ${t.prioridad === 'CRITICA' ? 'bg-red-600' : t.prioridad === 'ALTA' ? 'bg-orange-400' : t.prioridad === 'MEDIA' ? 'bg-yellow-300' : 'bg-gray-200'}`} />
                    <Link href={`/mantenimiento/${t.id}`} className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-gray-500">{t.numero}</span>
                        {est && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>}
                        {pri && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${pri.cls}`}>{pri.label}</span>}
                        <span className="text-[10px] text-gray-400">{TIPO_TICKET_META[t.tipo]?.label}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate">{t.titulo}</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        <span className="font-mono">{t.maquinaria?.codigo}</span> {t.maquinaria?.nombre}
                        {t.sede && <> · <MapPin className="inline w-3 h-3 -mt-0.5" /> {t.sede.nombre}</>}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {haceCuanto(t.created_at)} · {t.reportado_nombre ?? '—'}
                        {t.asignado_nombre ? <> → <span className="text-gray-600">{t.asignado_nombre}</span></> : ACTIVOS.includes(t.estado) && <span className="text-red-500"> · sin asignar</span>}
                        {t.ultimo_mensaje_at && <> · <MessageSquare className="inline w-3 h-3 -mt-0.5" /> {haceCuanto(t.ultimo_mensaje_at)}</>}
                      </p>
                    </Link>
                    {permisos.tecnico && t.estado === 'ABIERTO' ? (
                      <button onClick={() => recibir(t.id)} disabled={pending}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
                        {recibiendo === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Inbox className="w-3.5 h-3.5" />} Recibir
                      </button>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Equipos que requieren atención */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <h2 className="font-heading font-semibold text-sm text-gray-900">Equipos con alerta</h2>
            <Link href="/equipo" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline"><ScanLine className="w-3.5 h-3.5" /> Escanear</Link>
          </div>
          {permisos.jefe && (
            <div className="px-4 py-3 border-b border-gray-50">
              <button onClick={generarPreventivos} disabled={pending}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-50">
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />} Programar preventivos (próximos 7 días)
              </button>
            </div>
          )}
          {equipos.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">Sin equipos con alerta.</p>
          ) : (
            <ul className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
              {equipos.map((e) => {
                const m = ESTADO_MAQ_META[e.estado]
                const vencido = e.proximo_mant && new Date(e.proximo_mant + 'T00:00:00') <= new Date()
                return (
                  <li key={e.id}>
                    <Link href={`/equipo/${e.id}`} className="block px-4 py-2.5 hover:bg-gray-50">
                      <p className="text-sm text-gray-800 truncate"><span className="font-mono text-[11px] text-gray-500">{e.codigo}</span> {e.nombre}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {m && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>}
                        {e.condicion === 'MALA' && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CONDICION_META.MALA.cls}`}>Condición mala</span>}
                        {e.proximo_mant && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${vencido ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                            Preventivo {new Date(e.proximo_mant + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                          </span>
                        )}
                        {e.sedes?.nombre && <span className="text-[10px] text-gray-400 truncate">{e.sedes.nombre}</span>}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
