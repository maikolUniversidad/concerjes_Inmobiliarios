'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Wrench, MapPin, User, Clock, Inbox, Play, Pause, CheckCircle2, Lock, RotateCcw, Ban, UserPlus,
  ClipboardCheck, Loader2, ScanLine, CalendarDays, Stethoscope, Hammer, DollarSign,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { MantenimientoMensaje, MantenimientoTicket } from '@/lib/types/database'
import { ESTADOS_MAQ, ESTADO_MAQ_META } from '../../maquinaria/estados'
import {
  CONDICION_META, ESTADO_TICKET_META, PRIORIDAD_META, TIPO_TICKET_META, fechaHora,
} from '@/lib/mantenimiento'
import { Hoja, inputMant, labelMant } from '@/components/mantenimiento/Hoja'
import { FotosFirmadas } from '@/components/mantenimiento/FotosFirmadas'
import { ActividadForm } from '@/components/mantenimiento/ActividadForm'
import { ChatTicket } from './ChatTicket'

export type TicketDetalle = MantenimientoTicket & {
  maquinaria: { id: string; codigo: string; nombre: string; estado: string; condicion: string; imagen_url: string | null; ubicacion_texto: string | null }
  sede: { id: string; nombre: string } | null
}
type Accion = 'RECIBIR' | 'ASIGNAR' | 'INICIAR' | 'ESPERA' | 'RESOLVER' | 'CERRAR' | 'REABRIR' | 'CANCELAR'

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

function duracion(desde: string, hasta?: string | null) {
  const min = Math.max(0, Math.round(((hasta ? new Date(hasta) : new Date()).getTime() - new Date(desde).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ${min % 60} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

export function TicketClient({ ticket: t, mensajes, tecnicos, usuarioId, permisos }: {
  ticket: TicketDetalle
  mensajes: MantenimientoMensaje[]
  tecnicos: { id: string; nombre: string; rol_nombre: string | null }[]
  usuarioId: string
  permisos: { ver: boolean; reportar: boolean; tecnico: boolean; jefe: boolean }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [accion, setAccion] = useState<Accion | null>(null)
  const [actividad, setActividad] = useState(false)

  const est = ESTADO_TICKET_META[t.estado] ?? { label: t.estado, cls: 'bg-gray-100 text-gray-600' }
  const pri = PRIORIDAD_META[t.prioridad]
  const eqMeta = ESTADO_MAQ_META[t.maquinaria.estado]
  const cerrado = t.estado === 'CERRADO' || t.estado === 'CANCELADO'
  const esReportante = t.reportado_por === usuarioId
  const puedeConfirmar = permisos.tecnico || permisos.reportar || esReportante

  // Botones según estado y rol (la BD vuelve a validar todo).
  const botones: { accion: Accion; label: string; icon: typeof Play; cls: string; directa?: boolean }[] = []
  const prim = 'bg-brand-green text-white hover:bg-brand-green-dark'
  const sec = 'bg-white border border-gray-200 text-gray-700 hover:border-brand-green hover:text-brand-green'
  if (permisos.tecnico) {
    if (t.estado === 'ABIERTO') botones.push({ accion: 'RECIBIR', label: 'Recibir ticket', icon: Inbox, cls: prim, directa: true })
    if (['ABIERTO', 'RECIBIDO'].includes(t.estado)) botones.push({ accion: 'INICIAR', label: 'Iniciar trabajo', icon: Play, cls: t.estado === 'RECIBIDO' ? prim : sec })
    if (t.estado === 'EN_ESPERA') botones.push({ accion: 'INICIAR', label: 'Reanudar', icon: Play, cls: prim })
    if (t.estado === 'EN_PROCESO') botones.push({ accion: 'ESPERA', label: 'En espera', icon: Pause, cls: sec })
    if (['RECIBIDO', 'EN_PROCESO', 'EN_ESPERA'].includes(t.estado)) botones.push({ accion: 'RESOLVER', label: 'Resolver', icon: CheckCircle2, cls: t.estado === 'RECIBIDO' ? sec : prim })
  }
  if ((permisos.jefe || permisos.tecnico) && !cerrado && t.estado !== 'RESUELTO') {
    botones.push({ accion: 'ASIGNAR', label: permisos.jefe ? 'Asignar' : 'Tomar ticket', icon: UserPlus, cls: sec, directa: !permisos.jefe })
  }
  if (t.estado === 'RESUELTO' && puedeConfirmar) {
    botones.push({ accion: 'CERRAR', label: 'Confirmar y cerrar', icon: Lock, cls: prim, directa: true })
    botones.push({ accion: 'REABRIR', label: 'Sigue fallando', icon: RotateCcw, cls: sec })
  }
  if (!cerrado && t.estado !== 'RESUELTO' && (permisos.jefe || (esReportante && t.estado === 'ABIERTO'))) {
    botones.push({ accion: 'CANCELAR', label: 'Cancelar', icon: Ban, cls: 'bg-white border border-gray-200 text-red-600 hover:bg-red-50' })
  }
  // El técnico "toma" un ticket ya recibido por otro; si está abierto basta con Recibir.
  const visibles = botones.filter((b) => !(b.accion === 'ASIGNAR' && !permisos.jefe && (t.asignado_a === usuarioId || t.estado === 'ABIERTO')))

  function ejecutar(a: Accion, extra: Record<string, unknown> = {}) {
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (createClient() as any).rpc('mant_transicion', { p_ticket: t.id, p_accion: a, ...extra })
      if (error) { toast.error(error.message); return }
      toast.success('Ticket actualizado.')
      setAccion(null)
      router.refresh()
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px] items-start">
      <div className="space-y-4 min-w-0">
        {/* Cabecera */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-gray-700">{t.numero}</span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${est.cls}`}>{est.label}</span>
            {pri && <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${pri.cls}`}>Prioridad {pri.label.toLowerCase()}</span>}
            <span className="text-xs text-gray-500 px-2 py-1 rounded-full bg-gray-50">{TIPO_TICKET_META[t.tipo]?.label ?? t.tipo}</span>
          </div>
          <h1 className="mt-2 font-heading font-bold text-xl text-gray-900">{t.titulo}</h1>
          {t.descripcion && <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">{t.descripcion}</p>}

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-600">
            <p className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-gray-400" /> Reportó: {t.reportado_nombre ?? '—'} · {fechaHora(t.created_at)}</p>
            <p className="flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-gray-400" /> Asignado: {t.asignado_nombre ?? <span className="text-red-600 font-medium">sin asignar</span>}</p>
            {t.recibido_at && <p className="flex items-center gap-1.5"><Inbox className="w-3.5 h-3.5 text-gray-400" /> Recibió: {t.recibido_nombre ?? '—'} · en {duracion(t.created_at, t.recibido_at)}</p>}
            {t.programado_para && <p className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-gray-400" /> Programado: {new Date(t.programado_para + 'T00:00:00').toLocaleDateString('es-CO')}</p>}
            <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-gray-400" />
              {t.resuelto_at ? `Resuelto en ${duracion(t.created_at, t.resuelto_at)}` : cerrado ? `Cerrado ${t.cerrado_at ? fechaHora(t.cerrado_at) : ''}` : `Abierto hace ${duracion(t.created_at)}`}
            </p>
          </div>

          {t.fotos?.length > 0 && (
            <div className="mt-3">
              <p className={labelMant}>Fotos del reporte</p>
              <FotosFirmadas rutas={t.fotos} tam="h-24 w-24" />
            </div>
          )}

          {visibles.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {visibles.map((b) => (
                <button key={b.accion + b.label} disabled={pending}
                  onClick={() => b.directa
                    ? ejecutar(b.accion, b.accion === 'ASIGNAR' ? { p_asignado: usuarioId } : {})
                    : setAccion(b.accion)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${b.cls}`}>
                  {pending && b.directa ? <Loader2 className="w-4 h-4 animate-spin" /> : <b.icon className="w-4 h-4" />} {b.label}
                </button>
              ))}
              {permisos.tecnico && !cerrado && (
                <button onClick={() => setActividad(true)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold ${sec}`}>
                  <ClipboardCheck className="w-4 h-4" /> Registrar actividad
                </button>
              )}
            </div>
          )}
          {t.estado === 'RESUELTO' && puedeConfirmar && (
            <p className="mt-2 text-xs text-emerald-700">Mantenimiento marcó el trabajo como resuelto. Verifica el equipo y confirma, o indica si sigue fallando.</p>
          )}
        </div>

        {/* Equipo */}
        <Link href={`/equipo/${t.maquinaria.id}`} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm hover:border-brand-green/40">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gray-100">
            {t.maquinaria.imagen_url
              ? <Image src={t.maquinaria.imagen_url} alt={t.maquinaria.nombre} fill sizes="56px" className="object-cover" />
              : <div className="flex h-full items-center justify-center text-gray-300"><Wrench className="w-6 h-6" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 truncate">{t.maquinaria.nombre}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="font-mono text-[11px] text-gray-500">{t.maquinaria.codigo}</span>
              {eqMeta && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${eqMeta.cls}`}>{eqMeta.label}</span>}
              {CONDICION_META[t.maquinaria.condicion] && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CONDICION_META[t.maquinaria.condicion].cls}`}>Condición {CONDICION_META[t.maquinaria.condicion].label.toLowerCase()}</span>}
            </div>
            <p className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5"><MapPin className="w-3 h-3" /> {[t.sede?.nombre, t.maquinaria.ubicacion_texto].filter(Boolean).join(' · ') || 'Sin ubicación'}</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand-green"><ScanLine className="w-4 h-4" /> Ver equipo</span>
        </Link>

        {/* Resultado técnico */}
        {(t.diagnostico || t.solucion || t.costo != null) && (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
            {t.diagnostico && (
              <div><p className={`${labelMant} flex items-center gap-1`}><Stethoscope className="w-3.5 h-3.5" /> Diagnóstico</p><p className="text-sm text-gray-700 whitespace-pre-line">{t.diagnostico}</p></div>
            )}
            {t.solucion && (
              <div><p className={`${labelMant} flex items-center gap-1`}><Hammer className="w-3.5 h-3.5" /> Trabajo realizado</p><p className="text-sm text-gray-700 whitespace-pre-line">{t.solucion}</p></div>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              {t.costo != null && <p className="flex items-center gap-1 text-gray-700"><DollarSign className="w-3.5 h-3.5 text-gray-400" /> {cop.format(t.costo)}</p>}
              {t.estado_equipo_final && <p className="text-gray-600">Equipo quedó: <b>{ESTADO_MAQ_META[t.estado_equipo_final]?.label}</b></p>}
            </div>
          </div>
        )}
      </div>

      <ChatTicket ticketId={t.id} maquinariaId={t.maquinaria_id} usuarioId={usuarioId} inicial={mensajes}
        cerrado={cerrado} onCambioTicket={() => router.refresh()} />

      {accion && (
        <AccionHoja accion={accion} ticket={t} tecnicos={tecnicos} pending={pending}
          onClose={() => setAccion(null)} onConfirmar={(extra) => ejecutar(accion, extra)} />
      )}
      {actividad && (
        <ActividadForm abierta onClose={() => setActividad(false)} esTecnico ticketId={t.id}
          maquina={{ id: t.maquinaria.id, codigo: t.maquinaria.codigo, nombre: t.maquinaria.nombre, condicion: t.maquinaria.condicion }} />
      )}
    </div>
  )
}

const TITULOS: Record<Accion, string> = {
  RECIBIR: 'Recibir ticket', ASIGNAR: 'Asignar ticket', INICIAR: 'Iniciar trabajo', ESPERA: 'Poner en espera',
  RESOLVER: 'Resolver ticket', CERRAR: 'Cerrar ticket', REABRIR: 'El equipo sigue fallando', CANCELAR: 'Cancelar ticket',
}

function AccionHoja({ accion, ticket, tecnicos, pending, onClose, onConfirmar }: {
  accion: Accion
  ticket: TicketDetalle
  tecnicos: { id: string; nombre: string; rol_nombre: string | null }[]
  pending: boolean
  onClose: () => void
  onConfirmar: (extra: Record<string, unknown>) => void
}) {
  const [nota, setNota] = useState('')
  const [diagnostico, setDiagnostico] = useState(ticket.diagnostico ?? '')
  const [solucion, setSolucion] = useState('')
  const [costo, setCosto] = useState('')
  const [estadoEquipo, setEstadoEquipo] = useState(accion === 'REABRIR' ? 'DANADA' : 'OPERATIVA')
  const [asignado, setAsignado] = useState(ticket.asignado_a ?? '')

  const notaObligatoria = accion === 'ESPERA' || accion === 'REABRIR' || accion === 'CANCELAR'

  function confirmar() {
    if (notaObligatoria && !nota.trim()) { toast.error('Escribe el motivo.'); return }
    if (accion === 'RESOLVER' && !solucion.trim()) { toast.error('Describe el trabajo realizado.'); return }
    if (accion === 'ASIGNAR' && !asignado) { toast.error('Elige a quién asignar.'); return }
    onConfirmar({
      p_nota: nota.trim() || null,
      ...(accion === 'RESOLVER' || accion === 'ESPERA' || accion === 'INICIAR' ? { p_diagnostico: diagnostico.trim() || null } : {}),
      ...(accion === 'RESOLVER' ? { p_solucion: solucion.trim(), p_costo: costo ? Number(costo) : null, p_estado_equipo: estadoEquipo } : {}),
      ...(accion === 'REABRIR' ? { p_estado_equipo: estadoEquipo } : {}),
      ...(accion === 'ASIGNAR' ? { p_asignado: asignado } : {}),
    })
  }

  return (
    <Hoja abierta titulo={`${TITULOS[accion]} · ${ticket.numero}`} onClose={onClose}
      pie={
        <button onClick={confirmar} disabled={pending}
          className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-white font-semibold text-sm disabled:opacity-60 ${accion === 'CANCELAR' ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-green hover:bg-brand-green-dark'}`}>
          {pending && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar
        </button>
      }>
      {accion === 'ASIGNAR' && (
        <div>
          <label className={labelMant}>Técnico responsable</label>
          <select value={asignado} onChange={(e) => setAsignado(e.target.value)} className={inputMant}>
            <option value="">— Seleccionar —</option>
            {tecnicos.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.rol_nombre ? ` · ${u.rol_nombre}` : ''}</option>)}
          </select>
          {tecnicos.length === 0 && <p className="mt-1 text-xs text-gray-500">No hay usuarios con rol de mantenimiento. Asígnalo en Usuarios (Técnico o Jefe de Mantenimiento).</p>}
        </div>
      )}

      {(accion === 'INICIAR' || accion === 'ESPERA' || accion === 'RESOLVER') && (
        <div>
          <label className={labelMant}>Diagnóstico</label>
          <textarea value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} rows={2} className={`${inputMant} resize-none`} placeholder="Causa encontrada" />
        </div>
      )}

      {accion === 'RESOLVER' && (
        <>
          <div>
            <label className={labelMant}>Trabajo realizado <span className="text-red-500">*</span></label>
            <textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} rows={3} className={`${inputMant} resize-none`} placeholder="Repuestos cambiados, ajustes, pruebas…" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelMant}>Costo (COP)</label>
              <input type="number" min={0} value={costo} onChange={(e) => setCosto(e.target.value)} className={inputMant} placeholder="0" />
            </div>
            <div>
              <label className={labelMant}>El equipo queda</label>
              <select value={estadoEquipo} onChange={(e) => setEstadoEquipo(e.target.value)} className={inputMant}>
                {ESTADOS_MAQ.map((e) => <option key={e} value={e}>{ESTADO_MAQ_META[e].label}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {accion === 'REABRIR' && (
        <div>
          <label className={labelMant}>¿Cómo está el equipo?</label>
          <select value={estadoEquipo} onChange={(e) => setEstadoEquipo(e.target.value)} className={inputMant}>
            <option value="DANADA">No funciona (dañada)</option>
            <option value="EN_USO">Funciona con falla</option>
          </select>
        </div>
      )}

      <div>
        <label className={labelMant}>
          {accion === 'ESPERA' ? '¿Qué se está esperando?' : accion === 'CANCELAR' ? 'Motivo de cancelación' : accion === 'REABRIR' ? '¿Qué sigue fallando?' : 'Nota'}
          {notaObligatoria && <span className="text-red-500"> *</span>}
        </label>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={`${inputMant} resize-none`}
          placeholder={accion === 'ESPERA' ? 'Repuesto, proveedor, aprobación…' : 'Opcional'} />
      </div>
    </Hoja>
  )
}
