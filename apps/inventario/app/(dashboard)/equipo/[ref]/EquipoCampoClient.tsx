'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Wrench, MapPin, User, Tag, AlertTriangle, Headset, ClipboardCheck, Gauge, CalendarClock, History,
  ChevronRight, MessageSquare, FileText, CheckCircle2, XCircle, Clock, GitBranch, MoveRight, FilePlus2,
  Image as ImageIcon, PencilLine,
} from 'lucide-react'
import { ESTADO_MAQ_META } from '../../maquinaria/estados'
import {
  CONDICION_META, ESTADO_TICKET_META, PRIORIDAD_META, TIPO_ACTIVIDAD_META, TIPO_TICKET_META, fechaHora, haceCuanto,
} from '@/lib/mantenimiento'
import { ReportarFallaForm } from '@/components/mantenimiento/ReportarFallaForm'
import { ActividadForm } from '@/components/mantenimiento/ActividadForm'
import { EstadoEquipoForm } from '@/components/mantenimiento/EstadoEquipoForm'
import { FotosFirmadas } from '@/components/mantenimiento/FotosFirmadas'

export interface EquipoFicha {
  id: string; codigo: string; nombre: string; tipo: string | null; marca: string | null; modelo: string | null
  serial: string | null; estado: string; condicion: string; ubicacion_sede_id: string | null
  ubicacion_texto: string | null; responsable: string | null; imagen_url: string | null
  fecha_adquisicion: string | null; observaciones: string | null; activo: boolean
  frecuencia_mant_dias: number | null; ultimo_mant_at: string | null; proximo_mant: string | null
  sedes: { id: string; nombre: string } | null
}
export interface TicketResumen {
  id: string; numero: string; tipo: string; prioridad: string; estado: string; titulo: string
  reportado_nombre: string | null; created_at: string; resuelto_at: string | null
  programado_para: string | null; ultimo_mensaje_at: string | null; asignado_nombre: string | null
}
export interface ActividadRow {
  id: string; tipo: string; resultado: string; descripcion: string | null
  checklist: { item: string; ok: boolean }[]; condicion: string | null; fotos: string[]
  usuario_nombre: string | null; created_at: string; ticket_id: string | null
}
export interface EventoRow {
  id: string; tipo: string; descripcion: string; usuario_nombre: string | null
  usuario_email: string | null; created_at: string; ticket_id: string | null
}

const EVENTO_ICON: Record<string, { icon: typeof Wrench; cls: string }> = {
  CREACION: { icon: FilePlus2, cls: 'bg-gray-100 text-gray-600' },
  ESTADO: { icon: GitBranch, cls: 'bg-blue-100 text-blue-600' },
  UBICACION: { icon: MoveRight, cls: 'bg-indigo-100 text-indigo-600' },
  FOTO: { icon: ImageIcon, cls: 'bg-emerald-100 text-emerald-600' },
  MANTENIMIENTO: { icon: Wrench, cls: 'bg-amber-100 text-amber-600' },
  ACTIVIDAD: { icon: ClipboardCheck, cls: 'bg-teal-100 text-teal-600' },
  CONDICION: { icon: Gauge, cls: 'bg-pink-100 text-pink-600' },
  COMENTARIO: { icon: MessageSquare, cls: 'bg-purple-100 text-purple-600' },
}

const ACTIVOS = new Set(['ABIERTO', 'RECIBIDO', 'EN_PROCESO', 'EN_ESPERA', 'RESUELTO'])
type Tab = 'tickets' | 'actividades' | 'traza'

export function EquipoCampoClient({ maquina, tickets, actividades, eventos, permisos }: {
  maquina: EquipoFicha
  tickets: TicketResumen[]
  actividades: ActividadRow[]
  eventos: EventoRow[]
  permisos: { reportar: boolean; tecnico: boolean; verHojaVida: boolean; verTickets: boolean }
}) {
  const [hoja, setHoja] = useState<null | 'falla' | 'soporte' | 'actividad' | 'estado'>(null)
  const [tab, setTab] = useState<Tab>(permisos.verTickets ? 'tickets' : 'actividades')

  const meta = ESTADO_MAQ_META[maquina.estado] ?? { label: maquina.estado, cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' }
  const cond = CONDICION_META[maquina.condicion]
  const abiertos = tickets.filter((t) => ACTIVOS.has(t.estado))
  const historial = tickets.filter((t) => !ACTIVOS.has(t.estado))
  const dadoDeBaja = maquina.estado === 'BAJA' || !maquina.activo
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const vencido = maquina.proximo_mant ? new Date(maquina.proximo_mant + 'T00:00:00') <= hoy : false

  return (
    <div className="space-y-4">
      {/* Ficha */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="grid sm:grid-cols-[200px_1fr]">
          <div className="relative aspect-video sm:aspect-auto sm:h-full min-h-[160px] bg-gray-50">
            {maquina.imagen_url
              ? <Image src={maquina.imagen_url} alt={maquina.nombre} fill className="object-cover" sizes="(max-width: 640px) 100vw, 200px" />
              : <div className="flex h-full w-full items-center justify-center text-gray-300"><Wrench className="w-12 h-12" /></div>}
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-sm font-bold bg-gray-900 text-white px-2 py-0.5 rounded">{maquina.codigo}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${meta.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
              </span>
              {cond && <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cond.cls}`}>Condición {cond.label.toLowerCase()}</span>}
            </div>
            <h1 className="mt-2 font-heading font-bold text-xl text-gray-900">{maquina.nombre}</h1>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <p className="flex items-center gap-1.5 text-gray-600"><MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                {[maquina.sedes?.nombre, maquina.ubicacion_texto].filter(Boolean).join(' · ') || 'Sin ubicación'}</p>
              {maquina.tipo && <p className="flex items-center gap-1.5 text-gray-600"><Tag className="w-3.5 h-3.5 text-gray-400 shrink-0" /> {maquina.tipo}</p>}
              {maquina.responsable && <p className="flex items-center gap-1.5 text-gray-600"><User className="w-3.5 h-3.5 text-gray-400 shrink-0" /> {maquina.responsable}</p>}
              {(maquina.marca || maquina.modelo) && <p className="text-gray-500">{[maquina.marca, maquina.modelo].filter(Boolean).join(' · ')}</p>}
              {maquina.serial && <p className="text-gray-500">Serial: {maquina.serial}</p>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-gray-600">
                <History className="w-3.5 h-3.5" /> Último mant.: {maquina.ultimo_mant_at ? new Date(maquina.ultimo_mant_at).toLocaleDateString('es-CO') : 'sin registro'}
              </span>
              {maquina.proximo_mant && (
                <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 ${vencido ? 'bg-purple-50 text-purple-700 font-semibold' : 'bg-gray-50 text-gray-600'}`}>
                  <CalendarClock className="w-3.5 h-3.5" /> Próximo: {new Date(maquina.proximo_mant + 'T00:00:00').toLocaleDateString('es-CO')}{vencido && ' (vencido)'}
                </span>
              )}
            </div>
            {permisos.verHojaVida && (
              <Link href={`/maquinaria/${maquina.id}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline">
                <FileText className="w-3.5 h-3.5" /> Hoja de vida completa
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Acciones */}
      {dadoDeBaja ? (
        <p className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">Este equipo está dado de baja: no admite reportes.</p>
      ) : permisos.reportar && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button onClick={() => setHoja('falla')}
            className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center gap-1 rounded-2xl bg-red-600 py-4 text-white hover:bg-red-700">
            <AlertTriangle className="w-6 h-6" /><span className="text-sm font-semibold">Reportar falla</span>
          </button>
          <button onClick={() => setHoja('soporte')}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-white border border-gray-200 py-4 text-gray-700 hover:border-brand-green hover:text-brand-green">
            <Headset className="w-6 h-6" /><span className="text-sm font-semibold">Soporte remoto</span>
          </button>
          <button onClick={() => setHoja('actividad')}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-white border border-gray-200 py-4 text-gray-700 hover:border-brand-green hover:text-brand-green">
            <ClipboardCheck className="w-6 h-6" /><span className="text-sm font-semibold">Actividad</span>
          </button>
          {permisos.tecnico && (
            <button onClick={() => setHoja('estado')}
              className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center gap-1 rounded-2xl bg-white border border-gray-200 py-4 text-gray-700 hover:border-brand-green hover:text-brand-green">
              <Gauge className="w-6 h-6" /><span className="text-sm font-semibold">Definir estado</span>
            </button>
          )}
        </div>
      )}

      {/* Tickets abiertos, siempre visibles arriba */}
      {permisos.verTickets && abiertos.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
          <p className="px-1 font-heading font-semibold text-sm text-amber-800">En atención ({abiertos.length})</p>
          {abiertos.map((t) => <TicketCard key={t.id} t={t} />)}
        </div>
      )}

      {/* Pestañas */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 text-sm" role="tablist">
          {([
            ...(permisos.verTickets ? [['tickets', `Mantenimientos (${historial.length})`]] : []),
            ['actividades', `Actividades (${actividades.length})`],
            ['traza', 'Trazabilidad'],
          ] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`flex-1 px-3 py-3 font-medium ${tab === k ? 'text-brand-green border-b-2 border-brand-green' : 'text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="p-3">
          {tab === 'tickets' && (
            historial.length === 0
              ? <p className="py-6 text-center text-sm text-gray-400">Sin mantenimientos cerrados todavía.</p>
              : <div className="space-y-2">{historial.map((t) => <TicketCard key={t.id} t={t} />)}</div>
          )}

          {tab === 'actividades' && (
            actividades.length === 0
              ? <p className="py-6 text-center text-sm text-gray-400">Sin actividades registradas.</p>
              : <ul className="space-y-2">
                  {actividades.map((a) => (
                    <li key={a.id} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-start gap-2">
                        {a.resultado === 'NOVEDAD'
                          ? <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                          : <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            {TIPO_ACTIVIDAD_META[a.tipo]?.label ?? a.tipo} · <span className={a.resultado === 'NOVEDAD' ? 'text-red-600' : 'text-green-600'}>{a.resultado === 'NOVEDAD' ? 'con novedad' : 'sin novedad'}</span>
                          </p>
                          {a.descripcion && <p className="text-sm text-gray-600 whitespace-pre-line">{a.descripcion}</p>}
                          {a.checklist?.some((c) => !c.ok) && (
                            <p className="text-xs text-red-600 mt-0.5">Falla en: {a.checklist.filter((c) => !c.ok).map((c) => c.item).join(', ')}</p>
                          )}
                          <p className="text-[11px] text-gray-400 mt-0.5">{a.usuario_nombre ?? 'Usuario'} · {fechaHora(a.created_at)}{a.condicion && ` · condición ${CONDICION_META[a.condicion]?.label.toLowerCase()}`}</p>
                          {a.fotos?.length > 0 && <div className="mt-2"><FotosFirmadas rutas={a.fotos} /></div>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
          )}

          {tab === 'traza' && (
            <ol className="p-1 space-y-1">
              {eventos.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Sin eventos.</p>}
              {eventos.map((e) => {
                const ic = EVENTO_ICON[e.tipo] ?? { icon: PencilLine, cls: 'bg-gray-100 text-gray-600' }
                const contenido = (
                  <>
                    <p className="font-body text-sm text-gray-800">{e.descripcion}</p>
                    <p className="font-body text-[11px] text-gray-400 mt-0.5">{e.usuario_nombre ?? e.usuario_email ?? 'Sistema'} · {fechaHora(e.created_at)}</p>
                  </>
                )
                return (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${ic.cls}`}><ic.icon className="w-3.5 h-3.5" /></span>
                      <span className="w-px flex-1 bg-gray-100" />
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      {e.ticket_id && permisos.verTickets
                        ? <Link href={`/mantenimiento/${e.ticket_id}`} className="block hover:opacity-80">{contenido}</Link>
                        : contenido}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

      <ReportarFallaForm abierta={hoja === 'falla' || hoja === 'soporte'} onClose={() => setHoja(null)}
        key={hoja === 'soporte' ? 'soporte' : 'falla'}
        maquina={maquina} esTecnico={permisos.tecnico} modoInicial={hoja === 'soporte' ? 'SOPORTE_REMOTO' : 'CORRECTIVO'} />
      <ActividadForm abierta={hoja === 'actividad'} onClose={() => setHoja(null)} maquina={maquina}
        esTecnico={permisos.tecnico} onNovedad={() => setHoja('falla')} />
      {permisos.tecnico && (
        <EstadoEquipoForm abierta={hoja === 'estado'} onClose={() => setHoja(null)} maquina={maquina} key={`${maquina.estado}-${maquina.condicion}`} />
      )}
    </div>
  )
}

function TicketCard({ t }: { t: TicketResumen }) {
  const est = ESTADO_TICKET_META[t.estado] ?? { label: t.estado, cls: 'bg-gray-100 text-gray-600' }
  const pri = PRIORIDAD_META[t.prioridad]
  return (
    <Link href={`/mantenimiento/${t.id}`} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5 hover:border-brand-green/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-gray-500">{t.numero}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
          {pri && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${pri.cls}`}>{pri.label}</span>}
          <span className="text-[10px] text-gray-400">{TIPO_TICKET_META[t.tipo]?.label}</span>
        </div>
        <p className="mt-0.5 text-sm font-medium text-gray-800 truncate">{t.titulo}</p>
        <p className="text-[11px] text-gray-400 flex items-center gap-1">
          <Clock className="w-3 h-3" /> {haceCuanto(t.created_at)}
          {t.asignado_nombre && <> · {t.asignado_nombre}</>}
          {t.ultimo_mensaje_at && <> · <MessageSquare className="w-3 h-3" /> {haceCuanto(t.ultimo_mensaje_at)}</>}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
    </Link>
  )
}
