'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Wrench, MapPin, User, Clock, Inbox, Play, Pause, CheckCircle2, Lock, RotateCcw, Ban, UserPlus,
  ClipboardCheck, Loader2, ScanLine, CalendarDays, Stethoscope, Hammer, DollarSign,
  ThumbsUp, Truck, Timer, Building2, ShieldCheck, Signature, CalendarClock,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { MantenimientoMensaje, MantenimientoTicket } from '@/lib/types/database'
import { ESTADOS_MAQ, ESTADO_MAQ_META } from '../../maquinaria/estados'
import { ESTADO_ACTIVO, ESTADOS_ACTIVO, CRITICIDAD } from '@/lib/activos'
import {
  CONDICION_META, ESTADO_TICKET_META, PRIORIDAD_META, TIPO_TICKET_META, fechaHora,
  ORIGEN_TICKET_META, textoFrecuencia, type AccionTicket,
} from '@/lib/mantenimiento'
import { MaterialesOT } from '@/components/mantenimiento/MaterialesOT'
import { AbrirVisitaOT } from '@/components/mantenimiento/AbrirVisitaOT'
import { Hoja, inputMant, labelMant } from '@/components/mantenimiento/Hoja'
import { FotosFirmadas } from '@/components/mantenimiento/FotosFirmadas'
import { ActividadForm } from '@/components/mantenimiento/ActividadForm'
import { ChatTicket } from './ChatTicket'

export type TicketDetalle = MantenimientoTicket & {
  // UNO de los dos, nunca los dos: `maquinaria` es el equipo propio de la
  // empresa, `activo` la instalación del cliente. Antes `maquinaria` se tipaba
  // no nullable y la ficha de una orden de trabajo daba 500 al leer su estado.
  maquinaria: { id: string; codigo: string; nombre: string; estado: string; condicion: string; imagen_url: string | null; ubicacion_texto: string | null } | null
  activo: {
    id: string; codigo: string; nombre: string; estado: string; criticidad: string
    ubicacion_texto: string | null; piso: string | null; punto_id: string | null; fotos: string[]
    tipo: { nombre: string; normativa: string | null } | null
  } | null
  plan: { id: string; codigo: string; nombre: string; frecuencia_tipo: string; frecuencia_valor: number; obligatorio_normativo: boolean; normativa: string | null } | null
  proveedor: { id: string; nombre: string } | null
  sede: { id: string; nombre: string } | null
}

export interface MaterialFila {
  id: string; producto_id: string; producto_nombre: string | null
  cantidad: number; costo_unitario: number | null; costo_total: number
  movimiento_id: string | null; usuario_nombre: string | null; created_at: string
}

/** Las acciones de `mant_transicion`. `EN_SITIO` no está: lo escribe el
 *  escaneo de la placa, no un botón (decisión 4). */
type Accion = AccionTicket

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

function duracion(desde: string, hasta?: string | null) {
  const min = Math.max(0, Math.round(((hasta ? new Date(hasta) : new Date()).getTime() - new Date(desde).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ${min % 60} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

export function TicketClient({ ticket: t, mensajes, tecnicos, materiales, usuarioId, permisos }: {
  ticket: TicketDetalle
  mensajes: MantenimientoMensaje[]
  tecnicos: { id: string; nombre: string; rol_nombre: string | null }[]
  materiales: MaterialFila[]
  usuarioId: string
  permisos: { ver: boolean; reportar: boolean; tecnico: boolean; jefe: boolean }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [accion, setAccion] = useState<Accion | null>(null)
  const [actividad, setActividad] = useState(false)

  const est = ESTADO_TICKET_META[t.estado] ?? { label: t.estado, cls: 'bg-gray-100 text-gray-600' }
  const pri = PRIORIDAD_META[t.prioridad]
  // `?.` en todo lo del equipo: una orden de trabajo no tiene maquinaria.
  const eqMeta = t.maquinaria ? ESTADO_MAQ_META[t.maquinaria.estado] : undefined
  /** ¿Es una orden de trabajo sobre un activo del cliente? De esto cuelgan la
   *  aprobación obligatoria para cerrar, los materiales y la visita. */
  const esOT = !!t.activo_id
  const actMeta = t.activo ? ESTADO_ACTIVO[t.activo.estado as keyof typeof ESTADO_ACTIVO] : undefined
  const cerrado = t.estado === 'CERRADO' || t.estado === 'CANCELADO'
  const esperandoCierre = t.estado === 'RESUELTO' || t.estado === 'APROBADO_CLIENTE'
  const esReportante = t.reportado_por === usuarioId
  const puedeConfirmar = permisos.tecnico || permisos.reportar || esReportante
  const esMiOrden = t.asignado_a === usuarioId
  const enCurso = ['RECIBIDO', 'ACEPTADO', 'EN_CAMINO', 'EN_SITIO', 'EN_PROCESO', 'EN_ESPERA']

  // Botones según estado y rol (la BD vuelve a validar todo).
  const botones: { accion: Accion; label: string; icon: typeof Play; cls: string; directa?: boolean }[] = []
  const prim = 'bg-brand-green text-white hover:bg-brand-green-dark'
  const sec = 'bg-white border border-gray-200 text-gray-700 hover:border-brand-green hover:text-brand-green'
  if (permisos.tecnico) {
    if (t.estado === 'ABIERTO') botones.push({ accion: 'RECIBIR', label: 'Recibir ticket', icon: Inbox, cls: prim, directa: true })
    // Los tres estados intermedios son OPCIONALES y solo los mueve el técnico
    // asignado: aceptar o salir «por otro» no mide nada. Se ofrecen en la
    // orden de trabajo, donde sirven para el SLA; para un correctivo de
    // maquinaria el camino corto sigue siendo el de siempre.
    if (esOT && esMiOrden && t.estado === 'RECIBIDO') {
      botones.push({ accion: 'ACEPTAR', label: 'Aceptar la orden', icon: ThumbsUp, cls: prim, directa: true })
    }
    if (esOT && esMiOrden && ['RECIBIDO', 'ACEPTADO'].includes(t.estado)) {
      botones.push({ accion: 'SALIR', label: 'Voy en camino', icon: Truck, cls: t.estado === 'ACEPTADO' ? prim : sec, directa: true })
    }
    if (['ABIERTO', 'RECIBIDO', 'ACEPTADO', 'EN_CAMINO', 'EN_SITIO'].includes(t.estado)) {
      botones.push({ accion: 'INICIAR', label: 'Iniciar trabajo', icon: Play, cls: ['RECIBIDO', 'EN_SITIO'].includes(t.estado) ? prim : sec })
    }
    if (t.estado === 'EN_ESPERA') botones.push({ accion: 'INICIAR', label: 'Reanudar', icon: Play, cls: prim })
    if (t.estado === 'EN_PROCESO') botones.push({ accion: 'ESPERA', label: 'En espera', icon: Pause, cls: sec })
    if (enCurso.includes(t.estado)) {
      botones.push({ accion: 'RESOLVER', label: 'Resolver', icon: CheckCircle2, cls: t.estado === 'RECIBIDO' ? sec : prim })
    }
  }
  if ((permisos.jefe || permisos.tecnico) && !cerrado && !esperandoCierre) {
    botones.push({ accion: 'ASIGNAR', label: permisos.jefe ? 'Asignar' : 'Tomar ticket', icon: UserPlus, cls: sec, directa: !permisos.jefe })
  }
  if (t.estado === 'RESUELTO' && puedeConfirmar) {
    // La diferencia de la decisión 2: una orden de un activo del cliente pasa
    // por la aprobación del cliente antes de cerrarse; un ticket de maquinaria
    // propia se cierra directo, como siempre.
    if (esOT) {
      botones.push({ accion: 'APROBAR_CLIENTE', label: 'Registrar aprobación del cliente', icon: Signature, cls: prim })
    } else {
      botones.push({ accion: 'CERRAR', label: 'Confirmar y cerrar', icon: Lock, cls: prim, directa: true })
    }
    botones.push({ accion: 'REABRIR', label: 'Sigue fallando', icon: RotateCcw, cls: sec })
  }
  if (t.estado === 'APROBADO_CLIENTE' && puedeConfirmar) {
    botones.push({ accion: 'CERRAR', label: 'Cerrar la orden', icon: Lock, cls: prim, directa: true })
    botones.push({ accion: 'REABRIR', label: 'Sigue fallando', icon: RotateCcw, cls: sec })
  }
  if (!cerrado && !esperandoCierre && (permisos.jefe || (esReportante && t.estado === 'ABIERTO'))) {
    botones.push({ accion: 'CANCELAR', label: 'Cancelar', icon: Ban, cls: 'bg-white border border-gray-200 text-red-600 hover:bg-red-50' })
  }
  // El técnico "toma" un ticket ya recibido por otro; si está abierto basta con Recibir.
  const visibles = botones.filter((b) => !(b.accion === 'ASIGNAR' && !permisos.jefe && (esMiOrden || t.estado === 'ABIERTO')))

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
              {permisos.tecnico && !cerrado && t.maquinaria && (
                <button onClick={() => setActividad(true)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold ${sec}`}>
                  <ClipboardCheck className="w-4 h-4" /> Registrar actividad
                </button>
              )}
            </div>
          )}
          {t.estado === 'RESUELTO' && puedeConfirmar && (
            <p className="mt-2 text-xs text-emerald-700">
              {esOT
                ? 'Mantenimiento marcó el trabajo como resuelto. Registra la aprobación del cliente para poder cerrar, o indica si sigue fallando.'
                : 'Mantenimiento marcó el trabajo como resuelto. Verifica el equipo y confirma, o indica si sigue fallando.'}
            </p>
          )}
          {t.estado === 'APROBADO_CLIENTE' && puedeConfirmar && (
            <p className="mt-2 text-xs text-teal-700">El cliente ya aprobó la orden. Falta cerrarla para cortar el plazo y congelar los costos.</p>
          )}

          {/* `EN_SITIO` no es un botón de estado: sale de abrir la visita. */}
          {esOT && permisos.tecnico && !t.visita_id && !cerrado && !esperandoCierre && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className={labelMant}>Ejecución en sitio</p>
              <AbrirVisitaOT ticketId={t.id} tienePunto={!!t.activo?.punto_id} onListo={() => router.refresh()} />
            </div>
          )}
          {esOT && t.visita_id && (
            <p className="mt-3 text-xs text-gray-500">
              Esta orden se está ejecutando en la visita del motor de rondas: los pasos, las fotos y la
              firma del cliente quedan ahí.
            </p>
          )}
        </div>

        {/* El objeto: equipo propio O activo del cliente */}
        {t.maquinaria && (
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
        )}

        {t.activo && (
          <Link href={`/rondas/activos?activo=${t.activo.id}`} className="flex items-center gap-3 rounded-2xl border border-teal-100 bg-teal-50/40 p-3 shadow-sm hover:border-teal-300">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white text-teal-600">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{t.activo.nombre}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[11px] text-gray-500">{t.activo.codigo}</span>
                <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">Activo del cliente</span>
                {actMeta && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${actMeta.badge}`}>{actMeta.label}</span>}
                {CRITICIDAD[t.activo.criticidad as keyof typeof CRITICIDAD] && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CRITICIDAD[t.activo.criticidad as keyof typeof CRITICIDAD].badge}`}>
                    Criticidad {CRITICIDAD[t.activo.criticidad as keyof typeof CRITICIDAD].label.toLowerCase()}
                  </span>
                )}
                {t.activo.tipo?.normativa && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    <ShieldCheck className="w-3 h-3" /> {t.activo.tipo.normativa}
                  </span>
                )}
              </div>
              <p className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                <MapPin className="w-3 h-3" />
                {[t.sede?.nombre, t.activo.piso && `Piso ${t.activo.piso}`, t.activo.ubicacion_texto].filter(Boolean).join(' · ') || 'Sin ubicación'}
              </p>
              {!t.activo.punto_id && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Este activo no está asociado a un punto de control, y la visita en sitio se abre sobre un punto:
                  asócialo en su ficha para poder ejecutar la orden escaneando.
                </p>
              )}
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-teal-700"><ScanLine className="w-4 h-4" /> Ver activo</span>
          </Link>
        )}

        {/* De dónde salió y qué plazos corre */}
        {(t.plan || t.origen !== 'TICKET' || t.sla_respuesta_vence_at || t.proveedor) && (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-2 text-sm">
            {t.plan && (
              <p className="flex items-center gap-1.5 text-gray-700">
                <CalendarClock className="w-3.5 h-3.5 text-gray-400" />
                Plan <span className="font-mono text-xs text-gray-500">{t.plan.codigo}</span> · {t.plan.nombre} ·{' '}
                {textoFrecuencia(t.plan.frecuencia_tipo, t.plan.frecuencia_valor)}
                {t.plan.obligatorio_normativo && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    Obligatorio{t.plan.normativa ? ` · ${t.plan.normativa}` : ''}
                  </span>
                )}
              </p>
            )}
            {t.origen !== 'TICKET' && (
              <p className="text-xs text-gray-500">Origen: {ORIGEN_TICKET_META[t.origen]?.label ?? t.origen}</p>
            )}
            {t.proveedor && (
              <p className="text-xs text-gray-600">
                Lo ejecuta un proveedor externo: <b>{t.proveedor.nombre}</b>. No tiene cuenta en el sistema;
                quien registra el trabajo es el personal interno.
              </p>
            )}
            {(t.sla_respuesta_vence_at || t.sla_solucion_vence_at) && (
              <div className="flex flex-wrap gap-3 pt-1 text-xs">
                {t.sla_respuesta_vence_at && (
                  <Plazo icon={Timer} label="Responder antes de" vence={t.sla_respuesta_vence_at} cumplido={t.sla_respuesta_cumplido} hecho={!!t.respondido_at} />
                )}
                {t.sla_solucion_vence_at && (
                  <Plazo icon={Timer} label="Resolver antes de" vence={t.sla_solucion_vence_at} cumplido={t.sla_solucion_cumplido} hecho={!!t.resuelto_at} />
                )}
              </div>
            )}
            {/* Las marcas de los tres estados opcionales, solo las que existan. */}
            {(t.aceptado_at || t.en_camino_at || t.en_sitio_at) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-gray-600">
                {t.aceptado_at && <span>Aceptada: {fechaHora(t.aceptado_at)}</span>}
                {t.en_camino_at && <span>En camino: {fechaHora(t.en_camino_at)}</span>}
                {t.en_sitio_at && (
                  <span>
                    En sitio: {fechaHora(t.en_sitio_at)}
                    {t.en_sitio_modo === 'QR'
                      ? <span className="ml-1 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700">placa escaneada</span>
                      : <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">apertura manual</span>}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Materiales: mueven inventario de verdad */}
        {esOT && (
          <MaterialesOT ticketId={t.id} materiales={materiales} cerrado={cerrado || esperandoCierre}
            puedeEditar={permisos.tecnico} onCambio={() => router.refresh()} />
        )}

        {/* La aprobación del cliente */}
        {t.aprobado_cliente_at && (
          <div className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4 shadow-sm">
            <p className={`${labelMant} flex items-center gap-1`}><Signature className="w-3.5 h-3.5" /> Aprobación del cliente</p>
            {t.aprobado_tacito ? (
              <p className="text-sm text-gray-700">
                Aprobada <b>tácitamente</b>: venció el plazo del contrato sin respuesta del cliente,
                el {fechaHora(t.aprobado_cliente_at)}. No hay firma.
              </p>
            ) : (
              <p className="text-sm text-gray-700">
                {t.aprobado_cliente_nombre ?? 'El cliente'}
                {t.aprobado_cliente_cargo ? ` · ${t.aprobado_cliente_cargo}` : ''} · {fechaHora(t.aprobado_cliente_at)}
                {t.firma_cliente_id ? ' · con firma en el sitio' : ' · sin firma (registro por nombre y cargo)'}
              </p>
            )}
          </div>
        )}
        {esOT && t.estado === 'RESUELTO' && t.aprobacion_vence_at && (
          <p className="text-xs text-gray-500">
            Si el cliente no responde antes del {fechaHora(t.aprobacion_vence_at)}, la orden se aprueba
            por vencimiento del plazo del contrato y queda marcada como aprobación tácita.
          </p>
        )}

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
              {t.costo != null && (
                <p className="flex items-center gap-1 text-gray-700">
                  <DollarSign className="w-3.5 h-3.5 text-gray-400" /> {cop.format(t.costo)}
                  {(t.costo_mano_obra != null || t.costo_materiales > 0) && (
                    <span className="text-xs text-gray-500">
                      (mano de obra {cop.format(t.costo_mano_obra ?? 0)} + materiales {cop.format(t.costo_materiales)})
                    </span>
                  )}
                </p>
              )}
              {t.estado_equipo_final && <p className="text-gray-600">Equipo quedó: <b>{ESTADO_MAQ_META[t.estado_equipo_final]?.label}</b></p>}
              {t.estado_activo_final && (
                <p className="text-gray-600">
                  Activo quedó: <b>{ESTADO_ACTIVO[t.estado_activo_final as keyof typeof ESTADO_ACTIVO]?.label ?? t.estado_activo_final}</b>
                </p>
              )}
              {t.reaperturas > 0 && (
                <p className="text-amber-700">Reaperturas: <b>{t.reaperturas}</b></p>
              )}
            </div>
          </div>
        )}
      </div>

      <ChatTicket ticketId={t.id} maquinariaId={t.maquinaria_id ?? t.activo_id ?? t.id} usuarioId={usuarioId} inicial={mensajes}
        cerrado={cerrado} onCambioTicket={() => router.refresh()} />

      {accion && (
        <AccionHoja accion={accion} ticket={t} tecnicos={tecnicos} pending={pending}
          onClose={() => setAccion(null)} onConfirmar={(extra) => ejecutar(accion, extra)} />
      )}
      {actividad && t.maquinaria && (
        <ActividadForm abierta onClose={() => setActividad(false)} esTecnico ticketId={t.id}
          maquina={{ id: t.maquinaria.id, codigo: t.maquinaria.codigo, nombre: t.maquinaria.nombre, condicion: t.maquinaria.condicion }} />
      )}
    </div>
  )
}

const TITULOS: Record<Accion, string> = {
  RECIBIR: 'Recibir ticket', ASIGNAR: 'Asignar ticket', ACEPTAR: 'Aceptar la orden',
  SALIR: 'Voy en camino', INICIAR: 'Iniciar trabajo', ESPERA: 'Poner en espera',
  RESOLVER: 'Resolver ticket', APROBAR_CLIENTE: 'Aprobación del cliente',
  CERRAR: 'Cerrar ticket', REABRIR: 'El equipo sigue fallando', CANCELAR: 'Cancelar ticket',
}

/** Un plazo del contrato, con su semáforo. Vencido y sin cumplir es rojo; lo
 *  cumplido es verde aunque ya pasara la fecha. */
function Plazo({ icon: Icon, label, vence, cumplido, hecho }: {
  icon: typeof Timer; label: string; vence: string; cumplido: boolean | null; hecho: boolean
}) {
  const vencido = !hecho && new Date(vence) < new Date()
  const cls = cumplido === true ? 'bg-emerald-50 text-emerald-700'
    : cumplido === false || vencido ? 'bg-red-50 text-red-700'
    : 'bg-gray-50 text-gray-600'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${cls}`}>
      <Icon className="w-3 h-3" /> {label} {fechaHora(vence)}
      {cumplido === true && ' · cumplido'}
      {cumplido === false && ' · incumplido'}
      {cumplido === null && vencido && ' · vencido'}
    </span>
  )
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
  const [estadoActivo, setEstadoActivo] = useState(accion === 'REABRIR' ? 'DEGRADADO' : 'OPERATIVO')
  const [asignado, setAsignado] = useState(ticket.asignado_a ?? '')
  const [quienAprueba, setQuienAprueba] = useState('')
  const [cargoAprueba, setCargoAprueba] = useState('')

  const esOT = !!ticket.activo_id
  const notaObligatoria = accion === 'ESPERA' || accion === 'REABRIR' || accion === 'CANCELAR'

  function confirmar() {
    if (notaObligatoria && !nota.trim()) { toast.error('Escribe el motivo.'); return }
    if (accion === 'RESOLVER' && !solucion.trim()) { toast.error('Describe el trabajo realizado.'); return }
    if (accion === 'ASIGNAR' && !asignado) { toast.error('Elige a quién asignar.'); return }
    if (accion === 'APROBAR_CLIENTE' && !quienAprueba.trim()) {
      toast.error('Escribe el nombre de quien recibe por el cliente.'); return
    }
    onConfirmar({
      p_nota: nota.trim() || null,
      ...(accion === 'RESOLVER' || accion === 'ESPERA' || accion === 'INICIAR' ? { p_diagnostico: diagnostico.trim() || null } : {}),
      ...(accion === 'RESOLVER' ? { p_solucion: solucion.trim(), p_costo: costo ? Number(costo) : null } : {}),
      // El estado del objeto: el del equipo propio o el del activo, según cuál
      // sea; mandar el del otro no hace nada porque la RPC lo ignora.
      ...((accion === 'RESOLVER' || accion === 'REABRIR') && !esOT ? { p_estado_equipo: estadoEquipo } : {}),
      ...((accion === 'RESOLVER' || accion === 'REABRIR') && esOT ? { p_estado_activo: estadoActivo } : {}),
      ...(accion === 'ASIGNAR' ? { p_asignado: asignado } : {}),
      // La firma NO se manda: si la orden se ejecutó en sitio, `mant_transicion`
      // toma la firma de cliente de esa visita. Aquí solo van el nombre y el
      // cargo, que son lo que hace falta cuando no hubo visita.
      ...(accion === 'APROBAR_CLIENTE' ? {
        p_aprobado_nombre: quienAprueba.trim(),
        p_aprobado_cargo: cargoAprueba.trim() || null,
      } : {}),
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
              <label className={labelMant}>{esOT ? 'El activo queda' : 'El equipo queda'}</label>
              {esOT ? (
                <select value={estadoActivo} onChange={(e) => setEstadoActivo(e.target.value)} className={inputMant}>
                  {ESTADOS_ACTIVO.filter((e) => e !== 'RETIRADO').map((e) => (
                    <option key={e} value={e}>{ESTADO_ACTIVO[e].label}</option>
                  ))}
                </select>
              ) : (
                <select value={estadoEquipo} onChange={(e) => setEstadoEquipo(e.target.value)} className={inputMant}>
                  {ESTADOS_MAQ.map((e) => <option key={e} value={e}>{ESTADO_MAQ_META[e].label}</option>)}
                </select>
              )}
            </div>
          </div>
        </>
      )}

      {accion === 'REABRIR' && (
        <div>
          <label className={labelMant}>{esOT ? '¿Cómo está el activo?' : '¿Cómo está el equipo?'}</label>
          {esOT ? (
            <select value={estadoActivo} onChange={(e) => setEstadoActivo(e.target.value)} className={inputMant}>
              <option value="FUERA_SERVICIO">No se puede usar (fuera de servicio)</option>
              <option value="DEGRADADO">Funciona a medias (degradado)</option>
            </select>
          ) : (
            <select value={estadoEquipo} onChange={(e) => setEstadoEquipo(e.target.value)} className={inputMant}>
              <option value="DANADA">No funciona (dañada)</option>
              <option value="EN_USO">Funciona con falla</option>
            </select>
          )}
        </div>
      )}

      {accion === 'APROBAR_CLIENTE' && (
        <>
          <p className="rounded-xl bg-teal-50 p-3 text-xs text-teal-900">
            {ticket.visita_id
              ? 'La orden se ejecutó en sitio: si el cliente firmó en la visita, la firma se adjunta sola. Escribe igual quién recibe, para que el informe diga el nombre.'
              : 'Esta orden no tiene visita en sitio, así que no hay firma: la aprobación se registra con el nombre y el cargo de quien recibe por el cliente.'}
          </p>
          <div>
            <label className={labelMant}>Quién recibe por el cliente <span className="text-red-500">*</span></label>
            <input value={quienAprueba} onChange={(e) => setQuienAprueba(e.target.value)} className={inputMant}
              placeholder="Nombre de quien recibe" />
          </div>
          <div>
            <label className={labelMant}>Cargo</label>
            <input value={cargoAprueba} onChange={(e) => setCargoAprueba(e.target.value)} className={inputMant}
              placeholder="Administrador, jefe de mantenimiento del edificio…" />
          </div>
        </>
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
