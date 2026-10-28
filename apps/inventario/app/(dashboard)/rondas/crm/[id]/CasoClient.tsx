'use client'

// Un caso del CRM. Es la pantalla donde está el botón que hace que una
// respuesta salga, y por eso es la pantalla que más tiene que decir la verdad:
//
//   · Lo que escribió el modelo se muestra en su propio bloque, de otro color,
//     rotulado «Sugerido por IA — revisá y confirmá», con el modelo y la
//     versión del prompt a la vista (ADR-02 §4.4). Al aprobar, el rótulo cambia
//     a «Aprobado por [persona] el [fecha]».
//   · El texto se puede EDITAR antes de mandarlo. Si se edita, se guarda que se
//     editó: es la única métrica real de si el modelo sirve (§4.1).
//   · Los dos valores conviven: «tipo sugerido» al lado de «tipo», nunca encima.
//   · Y lo que la conversación dijo se lee tal cual, incluso si trae
//     instrucciones para el modelo: eso es parte del caso, y quien lo atiende
//     tiene que verlo.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Sparkles, Send, ShieldCheck, AlertTriangle, PauseCircle,
  Timer, Tag, History, MessageSquare, UserPlus, Bot, User,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { leerSlaCon, formatearMinutos, type OpcionesHabiles } from '@/lib/crm/sla'
import {
  analizarCaso, aprobarRespuesta, asignarCaso, cambiarEstado,
  confirmarClasificacion, etiquetarCaso,
} from '../actions'

export interface CasoDetalle {
  id: string
  numero: string
  conversacion_id: string | null
  canal: string
  tipo: string
  estado: 'NUEVO' | 'EN_TRAMITE' | 'EN_ESPERA' | 'RESUELTO' | 'CERRADO'
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'
  grupo_id: string | null
  asunto: string
  descripcion?: string | null
  asignado_a: string | null
  asignado_nombre: string | null
  abierto_at: string
  resuelto_at: string | null
  cerrado_at: string | null
  cierre_motivo?: string | null
  motivo_apertura?: string | null
  abierto_por_tipo?: string | null
  resumen_ia: string | null
  tipo_ia: string | null
  prioridad_ia: string | null
  ia_confianza: number | null
  ia_generado_at: string | null
  ia_confirmado_at: string | null
  ia_modelo?: string | null
  ia_prompt_version?: string | null
  ia_mensajes_vistos?: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clasificacion_ia?: any
  respuesta_ia?: string | null
  respuesta_aprobada_texto?: string | null
  respuesta_aprobada_at?: string | null
  respuesta_editada?: boolean | null
  aprobador?: { nombre: string } | null
  confirmador?: { nombre: string } | null
  contrato_codigo: string | null
  contrato_nombre: string | null
  sede_nombre: string | null
  wa_id: string | null
  perfil_nombre: string | null
  ventana_vence_at: string | null
  sla_prioridad: string | null
  minutos_primera_respuesta: number | null
  minutos_resolucion: number | null
  horas_habiles: boolean | null
  vence_primera_at: string | null
  vence_resolucion_at: string | null
  primera_respuesta_at: string | null
  pausado_min: number | null
  pausado_desde: string | null
  pausas: number | null
  incumplido: boolean | null
  incumplido_que: string | null
  reloj_en_pausa: boolean | null
  etiquetas: { codigo: string; nombre: string; color: string; origen: string }[]
}

export interface MensajeFila {
  id: string
  direccion: 'ENTRANTE' | 'SALIENTE'
  tipo: string
  texto: string | null
  estado: string
  iniciado_por: string | null
  es_plantilla: boolean
  plantilla_nombre: string | null
  omitido_motivo: string | null
  error: string | null
  created_at: string
  enviado_at: string | null
}

export interface EtiquetaFila {
  id: string; codigo: string; nombre: string; color: string
  grupo_id: string | null; activo: boolean
}
export interface AsignacionFila {
  id: string; usuario_nombre: string | null; motivo: string | null
  desde: string; hasta: string | null
}
export interface AgenteFila { id: string; nombre: string; rol: string }
export interface EventoFila {
  id: number; accion: string; actor_tipo: string; actor_nombre: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detalle: any; created_at: string
}

const tarjeta = 'rounded-xl border border-gray-200 bg-white p-4'
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-semibold'

const TIPOS = ['CONSULTA', 'VISITA', 'PQRS', 'MANTENIMIENTO', 'SOPORTE',
               'IDENTIDAD', 'CONSENTIMIENTO', 'ADMINISTRATIVO', 'OTRO'] as const
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const

const COLOR_PRIORIDAD: Record<string, string> = {
  CRITICA: 'bg-red-50 text-red-700',
  ALTA: 'bg-orange-50 text-orange-700',
  MEDIA: 'bg-sky-50 text-sky-700',
  BAJA: 'bg-gray-100 text-gray-600',
}
const COLOR_ESTADO: Record<string, string> = {
  NUEVO: 'bg-amber-50 text-amber-700',
  EN_TRAMITE: 'bg-blue-50 text-blue-700',
  EN_ESPERA: 'bg-violet-50 text-violet-700',
  RESUELTO: 'bg-emerald-50 text-emerald-700',
  CERRADO: 'bg-gray-100 text-gray-600',
}

function numeroCorto(waId: string | null): string {
  if (!waId) return '—'
  if (waId.length <= 6) return '••••'
  return `${waId.slice(0, 2)}•••••${waId.slice(-3)}`
}

function hora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
  })
}

export function CasoClient({
  caso, mensajes, etiquetas, asignaciones, agentes, eventos, festivos,
  puedeGestionar, iaEncendida, iaModelo, faltaParaIa,
}: {
  caso: CasoDetalle
  mensajes: MensajeFila[]
  etiquetas: EtiquetaFila[]
  asignaciones: AsignacionFila[]
  agentes: AgenteFila[]
  eventos: EventoFila[]
  festivos: string[]
  puedeGestionar: boolean
  iaEncendida: boolean
  iaModelo: string
  faltaParaIa: string[]
}) {
  const router = useRouter()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [enCurso, empezar] = useTransition()
  // El texto que de verdad se va a mandar. Arranca con el borrador del modelo y
  // se puede reescribir: las dos cosas valen, porque las dos pasan por una
  // persona. Lo que no vale es que no pase por nadie.
  const [texto, setTexto] = useState(caso.respuesta_ia ?? '')
  const [confirmaViejo, setConfirmaViejo] = useState(false)
  const borradorRef = useRef<string | null>(caso.respuesta_ia ?? null)

  // Si llega un borrador nuevo del servidor (porque se volvió a analizar), se
  // adopta; si el agente ya escribió encima, no se le pisa lo escrito.
  useEffect(() => {
    if (caso.respuesta_ia !== borradorRef.current) {
      borradorRef.current = caso.respuesta_ia ?? null
      setTexto(caso.respuesta_ia ?? '')
      setConfirmaViejo(false)
    }
  }, [caso.respuesta_ia])

  // Realtime en la conversación: un mensaje que entra se ve sin recargar.
  const sb = useMemo(() => createClient(), [])
  useEffect(() => {
    if (!caso.conversacion_id) return
    const canal = sb.channel(`crm-caso:${caso.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'crm_mensajes',
        filter: `conversacion_id=eq.${caso.conversacion_id}`,
      }, () => router.refresh())
      .subscribe()
    return () => { sb.removeChannel(canal) }
  }, [sb, router, caso.id, caso.conversacion_id])

  // El reloj dibujado con la MISMA aritmética que calculó la base, y con el
  // calendario COMPARTIDO de festivos que llega del servidor.
  const opciones: OpcionesHabiles = useMemo(() => ({
    desdeHora: '08:00',
    hastaHora: '17:00',
    zona: 'America/Bogota',
    noHabiles: festivos,
  }), [festivos])

  const reloj = useMemo(() => {
    if (!caso.minutos_primera_respuesta || !caso.minutos_resolucion) return null
    return leerSlaCon({
      arrancaAt: caso.abierto_at,
      minutosPrimeraRespuesta: caso.minutos_primera_respuesta,
      minutosResolucion: caso.minutos_resolucion,
      horasHabiles: caso.horas_habiles ?? true,
      jornadaDesde: opciones.desdeHora,
      jornadaHasta: opciones.hastaHora,
      zona: opciones.zona,
      primeraRespuestaAt: caso.primera_respuesta_at,
      resueltoAt: caso.resuelto_at,
      pausadoMin: caso.pausado_min ?? 0,
      pausadoDesde: caso.pausado_desde,
    }, new Date(), opciones)
  }, [caso, opciones])

  const puestas = new Set(caso.etiquetas.map((e) => e.codigo))
  const entrantes = mensajes.filter((m) => m.estado === 'RECIBIDO').length
  const vistos = caso.ia_mensajes_vistos ?? null
  const totalVisibles = mensajes.filter((m) =>
    ['RECIBIDO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'SIMULADO'].includes(m.estado)).length
  const borradorViejo = vistos !== null && totalVisibles > vistos && !!caso.respuesta_ia
  const intentoInstruccion = !!caso.clasificacion_ia?.intento_de_instruccion
  const descartado: string[] = Array.isArray(caso.clasificacion_ia?.descartado)
    ? caso.clasificacion_ia.descartado : []

  function correr(
    fn: (fd: FormData) => Promise<{ error?: string; ok?: boolean; aviso?: string }>,
    fd: FormData,
  ) {
    empezar(async () => {
      const r = await fn(fd)
      if (r.error) setAviso({ tipo: 'error', texto: r.error })
      else setAviso({ tipo: 'ok', texto: r.aviso ?? 'Hecho.' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <Link href="/rondas/crm"
            className="inline-flex items-center gap-1 font-body text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver a la bandeja
      </Link>

      {/* ── Cabecera del caso ── */}
      <div className={tarjeta}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-gray-900">{caso.numero}</span>
              <span className={`${chip} ${COLOR_ESTADO[caso.estado]}`}>{caso.estado.replace('_', ' ')}</span>
              <span className={`${chip} ${COLOR_PRIORIDAD[caso.prioridad]}`}>{caso.prioridad}</span>
              <span className={`${chip} bg-gray-100 text-gray-600`}>{caso.tipo}</span>
            </div>
            <h1 className="mt-1 font-display text-xl font-bold text-gray-900">{caso.asunto}</h1>
            <p className="font-body text-xs text-gray-500">
              {caso.contrato_codigo
                ? `${caso.contrato_codigo} — ${caso.contrato_nombre}`
                : 'Sin contrato identificado'}
              {caso.sede_nombre ? ` · ${caso.sede_nombre}` : ''}
              {' · '}
              <span className="font-mono">{numeroCorto(caso.wa_id)}</span>
              {caso.perfil_nombre ? ` (${caso.perfil_nombre})` : ''}
              {' · abierto '}{hora(caso.abierto_at)}
              {caso.abierto_por_tipo === 'BOT' && ' por el bot'}
              {caso.motivo_apertura ? ` (${caso.motivo_apertura.toLowerCase().replaceAll('_', ' ')})` : ''}
            </p>
          </div>

          {/* El reloj, con la pausa explicada. */}
          <div className="min-w-[220px] rounded-lg bg-gray-50 p-3">
            <div className="font-body text-[11px] uppercase tracking-wide text-gray-500">SLA</div>
            {!reloj ? (
              <div className="font-body text-sm text-gray-500">Sin reloj</div>
            ) : caso.incumplido ? (
              <div className="flex items-center gap-1 font-body text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Incumplido ({caso.incumplido_que === 'PRIMERA' ? 'primera respuesta'
                  : caso.incumplido_que === 'AMBOS' ? 'los dos plazos' : 'resolución'})
              </div>
            ) : caso.reloj_en_pausa ? (
              <div className="font-body text-sm font-semibold text-violet-700">
                <span className="flex items-center gap-1"><PauseCircle className="h-4 w-4" /> Reloj en pausa</span>
                <span className="font-normal text-xs text-gray-500">
                  Lleva {formatearMinutos(caso.pausado_min ?? 0)} parado, en {caso.pausas ?? 0} pausa(s).
                  En pausa el caso no puede quedar incumplido.
                </span>
              </div>
            ) : (
              <div className="space-y-1 font-body text-xs text-gray-700">
                <div className="flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  {caso.primera_respuesta_at
                    ? <>Contestado {hora(caso.primera_respuesta_at)}</>
                    : <><strong>{formatearMinutos(reloj.restaPrimeraMin)}</strong> para contestar</>}
                </div>
                <div className="flex items-center gap-1 text-gray-500">
                  <Timer className="h-3 w-3" />
                  {caso.resuelto_at
                    ? <>Resuelto {hora(caso.resuelto_at)}</>
                    : <><strong>{formatearMinutos(reloj.restaResolucionMin)}</strong> para resolver</>}
                </div>
              </div>
            )}
            <div className="mt-1 font-body text-[11px] text-gray-400">
              {caso.horas_habiles
                ? `Plazo en tiempo hábil (${opciones.desdeHora}–${opciones.hastaHora}, lun a vie, sin festivos)`
                : 'Plazo en reloj de pared, 24/7'}
              {(caso.pausado_min ?? 0) > 0 && ` · +${caso.pausado_min} min por pausas`}
            </div>
          </div>
        </div>

        {/* Etiquetas */}
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <Tag className="h-3 w-3 text-gray-400" />
          {caso.etiquetas.length === 0 && (
            <span className="font-body text-[11px] text-gray-400">sin etiquetas</span>
          )}
          {caso.etiquetas.map((e) => (
            <span key={e.codigo} className={`${chip} ring-1 ring-inset`}
                  style={{ color: e.color, borderColor: e.color }}
                  title={e.origen === 'IA'
                    ? `${e.nombre} — la sugirió la IA, todavía sin confirmar`
                    : e.nombre}>
              {e.codigo}
              {e.origen === 'IA' && <Sparkles className="h-2.5 w-2.5" />}
              {puedeGestionar && caso.estado !== 'CERRADO' && (
                <button type="button" disabled={enCurso}
                        onClick={() => {
                          const id = etiquetas.find((x) => x.codigo === e.codigo)?.id
                          if (!id) return
                          const fd = new FormData()
                          fd.set('caso_id', caso.id); fd.set('etiqueta_id', id); fd.set('quitar', '1')
                          correr(etiquetarCaso, fd)
                        }}
                        className="ml-0.5 text-gray-400 hover:text-red-600">×</button>
              )}
            </span>
          ))}
          {puedeGestionar && caso.estado !== 'CERRADO' && (
            <select value="" disabled={enCurso}
                    onChange={(e) => {
                      if (!e.target.value) return
                      const fd = new FormData()
                      fd.set('caso_id', caso.id); fd.set('etiqueta_id', e.target.value)
                      correr(etiquetarCaso, fd)
                    }}
                    className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 font-body text-[11px] text-gray-500">
              <option value="">+ etiqueta</option>
              {etiquetas.filter((e) => !puestas.has(e.codigo))
                .map((e) => <option key={e.id} value={e.id}>{e.codigo}</option>)}
            </select>
          )}
        </div>
      </div>

      {aviso && (
        <div className={`rounded-xl border p-3 font-body text-sm ${
          aviso.tipo === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-red-200 bg-red-50 text-red-900'}`}>
          {aviso.texto}
          <button type="button" onClick={() => setAviso(null)} className="ml-2 underline">cerrar</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* ── La conversación ── */}
        <div className={tarjeta}>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gray-900">
            <MessageSquare className="h-4 w-4" /> La conversación
            <span className="font-body text-xs font-normal text-gray-400">
              {entrantes} entrante(s) · {mensajes.length} mensaje(s)
            </span>
          </h2>
          {caso.ventana_vence_at && (
            <p className="mt-1 font-body text-[11px] text-gray-400">
              Ventana de 24 h de WhatsApp: {new Date(caso.ventana_vence_at) > new Date()
                ? `abierta hasta ${hora(caso.ventana_vence_at)}`
                : `cerrada desde ${hora(caso.ventana_vence_at)} — fuera de ella solo sale una plantilla aprobada`}
            </p>
          )}

          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {mensajes.length === 0 && (
              <p className="font-body text-sm text-gray-500">
                {caso.conversacion_id
                  ? 'La conversación no tiene mensajes todavía.'
                  : 'Este caso no viene de una conversación: lo abrió alguien desde la consola.'}
              </p>
            )}
            {mensajes.map((m) => (
              <div key={m.id}
                   className={`rounded-lg p-2 ${m.direccion === 'ENTRANTE'
                     ? 'bg-gray-50'
                     : m.estado.startsWith('OMITIDO')
                       ? 'border border-orange-200 bg-orange-50'
                       : 'bg-brand-50'}`}>
                <div className="flex items-center justify-between gap-2 font-body text-[11px] text-gray-500">
                  <span className="flex items-center gap-1">
                    {m.direccion === 'ENTRANTE'
                      ? <><User className="h-3 w-3" /> la persona</>
                      : m.iniciado_por === 'AGENTE'
                        ? <><ShieldCheck className="h-3 w-3" /> un agente</>
                        : <><Bot className="h-3 w-3" /> el bot</>}
                    {m.es_plantilla && m.plantilla_nombre && ` · plantilla ${m.plantilla_nombre}`}
                  </span>
                  <span>{hora(m.created_at)} · {m.estado.toLowerCase()}</span>
                </div>
                {/* El texto se muestra TAL CUAL, aunque traiga instrucciones para
                    un modelo: eso es parte del caso y quien lo atiende tiene que
                    verlo. React escapa el contenido, así que no hay riesgo de
                    inyección en la pantalla. */}
                <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm text-gray-800">
                  {m.texto ?? <em className="text-gray-400">({m.tipo.toLowerCase()} sin texto)</em>}
                </p>
                {m.omitido_motivo && (
                  <p className="mt-1 font-body text-[11px] font-semibold text-orange-700">
                    No salió: {m.omitido_motivo}
                  </p>
                )}
                {m.error && (
                  <p className="mt-1 font-body text-[11px] text-red-700">Error: {m.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── La IA y el botón que manda ── */}
        <div className="space-y-4">
          <div className={`${tarjeta} border-violet-200 bg-violet-50/40`}>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-violet-900">
              <Sparkles className="h-4 w-4" /> Lo que sugiere la IA
            </h2>

            {!iaEncendida && (
              <p className="mt-1 rounded-lg bg-amber-50 p-2 font-body text-xs text-amber-900">
                La IA del CRM está apagada. Falta en el entorno: {faltaParaIa.join(', ')}. El caso,
                el reloj y la respuesta a mano funcionan igual.
              </p>
            )}

            {caso.ia_generado_at ? (
              <>
                <div className="mt-2 font-body text-[11px] text-violet-700">
                  Generado {hora(caso.ia_generado_at)} con <strong>{caso.ia_modelo ?? '—'}</strong>
                  {caso.ia_prompt_version && ` · prompt ${caso.ia_prompt_version}`}
                  {caso.ia_confianza !== null &&
                    ` · confianza ${Math.round(Number(caso.ia_confianza) * 100)}%`}
                  {vistos !== null && ` · vio ${vistos} mensaje(s)`}
                </div>

                {intentoInstruccion && (
                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 font-body text-xs text-amber-900">
                    <strong>Esta conversación intentó darle instrucciones al modelo.</strong> Lo que
                    hay abajo es una sugerencia y nada más: el estado, el tipo y la prioridad reales
                    los cambia una persona, y la respuesta no sale hasta que alguien la apruebe.
                  </div>
                )}
                {descartado.length > 0 && (
                  <div className="mt-2 rounded-lg border border-gray-300 bg-white p-2 font-body text-[11px] text-gray-600">
                    Se descartaron campos que el modelo no debía devolver:{' '}
                    <code>{descartado.join(', ')}</code>. No se usaron.
                  </div>
                )}

                {caso.resumen_ia && (
                  <div className="mt-2">
                    <div className="font-body text-[11px] uppercase tracking-wide text-violet-700">Resumen</div>
                    <p className="font-body text-sm text-gray-800">{caso.resumen_ia}</p>
                  </div>
                )}

                {/* Los dos valores conviven: sugerido AL LADO de real. */}
                <div className="mt-2 grid grid-cols-2 gap-2 font-body text-xs">
                  <div className="rounded-lg bg-white p-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Tipo</div>
                    <div className="text-gray-900">{caso.tipo}</div>
                    {caso.tipo_ia && caso.tipo_ia !== caso.tipo && (
                      <div className="mt-0.5 text-violet-700">sugerido: {caso.tipo_ia}</div>
                    )}
                  </div>
                  <div className="rounded-lg bg-white p-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Prioridad</div>
                    <div className="text-gray-900">{caso.prioridad}</div>
                    {caso.prioridad_ia && caso.prioridad_ia !== caso.prioridad && (
                      <div className="mt-0.5 text-violet-700">sugerida: {caso.prioridad_ia}</div>
                    )}
                  </div>
                </div>

                {caso.ia_confirmado_at ? (
                  <p className="mt-2 flex items-center gap-1 font-body text-xs font-semibold text-emerald-700">
                    <ShieldCheck className="h-3 w-3" />
                    Confirmado por {caso.confirmador?.nombre ?? 'una persona'} el {hora(caso.ia_confirmado_at)}
                  </p>
                ) : puedeGestionar && caso.estado !== 'CERRADO' ? (
                  <form action={(fd) => correr(confirmarClasificacion, fd)}
                        className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-white p-2">
                    <input type="hidden" name="caso_id" value={caso.id} />
                    <label className="font-body text-[11px] text-gray-500">
                      Tipo
                      <select name="tipo" defaultValue={caso.tipo_ia ?? caso.tipo}
                              className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 font-body text-xs">
                        {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="font-body text-[11px] text-gray-500">
                      Prioridad
                      <select name="prioridad" defaultValue={caso.prioridad_ia ?? caso.prioridad}
                              className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 font-body text-xs">
                        {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1 font-body text-[11px] text-gray-500">
                      <input type="checkbox" name="aplicar_resumen" /> usar el resumen
                    </label>
                    <button type="submit" disabled={enCurso}
                            className="rounded-lg bg-violet-600 px-2.5 py-1.5 font-body text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                      Confirmar clasificación
                    </button>
                  </form>
                ) : null}
              </>
            ) : (
              <p className="mt-2 font-body text-sm text-gray-600">
                Este caso no se ha analizado todavía.
              </p>
            )}

            {puedeGestionar && iaEncendida && caso.conversacion_id && caso.estado !== 'CERRADO' && (
              <form action={(fd) => correr(analizarCaso, fd)} className="mt-3">
                <input type="hidden" name="caso_id" value={caso.id} />
                <button type="submit" disabled={enCurso}
                        className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 font-body text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50">
                  <Sparkles className="h-3 w-3" />
                  {caso.ia_generado_at ? 'Volver a analizar con la IA' : 'Analizar con la IA'}
                  {' '}({iaModelo})
                </button>
              </form>
            )}
          </div>

          {/* ── El único camino de salida ── */}
          <div className={tarjeta}>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gray-900">
              <Send className="h-4 w-4" /> Responder
            </h2>
            <p className="mt-1 font-body text-xs text-gray-500">
              {caso.respuesta_ia
                ? 'Abajo está el borrador que redactó la IA. Léelo, corrígelo si hace falta y apruébalo: hasta que le des al botón, no sale nada.'
                : 'Escribe la respuesta. Sale como agente, no como bot.'}
            </p>

            {caso.respuesta_aprobada_at && (
              <p className="mt-2 flex items-center gap-1 rounded-lg bg-emerald-50 p-2 font-body text-xs font-semibold text-emerald-800">
                <ShieldCheck className="h-3 w-3" />
                Aprobado por {caso.aprobador?.nombre ?? 'una persona'} el {hora(caso.respuesta_aprobada_at)}
                {caso.respuesta_editada ? ' (reescribió el borrador de la IA)' : ' (mandó el borrador tal cual)'}
              </p>
            )}

            {borradorViejo && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 font-body text-xs text-amber-900">
                Entraron <strong>{totalVisibles - (vistos ?? 0)}</strong> mensaje(s) después de que
                la IA redactó esto. El borrador contesta una conversación que ya cambió.
                <label className="mt-1 flex items-center gap-1">
                  <input type="checkbox" checked={confirmaViejo}
                         onChange={(e) => setConfirmaViejo(e.target.checked)} />
                  Lo mando así igual
                </label>
              </div>
            )}

            {puedeGestionar && caso.estado !== 'CERRADO' && caso.conversacion_id ? (
              <form action={(fd) => correr(aprobarRespuesta, fd)} className="mt-2 space-y-2">
                <input type="hidden" name="caso_id" value={caso.id} />
                {confirmaViejo && <input type="hidden" name="confirma_desactualizado" value="1" />}
                {caso.respuesta_ia && (
                  <div className="font-body text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                    Sugerido por IA — revísalo y confírmalo
                  </div>
                )}
                <textarea name="texto" value={texto} onChange={(e) => setTexto(e.target.value)}
                          rows={6} maxLength={4096} required
                          placeholder="Lo que se le va a escribir a la persona…"
                          className={`w-full rounded-lg border px-3 py-2 font-body text-sm ${
                            caso.respuesta_ia && texto === caso.respuesta_ia
                              ? 'border-violet-300 bg-violet-50/60 text-gray-800'
                              : 'border-gray-300'}`} />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-body text-[11px] text-gray-400">
                    {texto.length}/4096
                    {caso.respuesta_ia && texto !== caso.respuesta_ia && ' · lo reescribiste'}
                  </span>
                  <button type="submit" disabled={enCurso || texto.trim() === ''}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 font-body text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                    <Send className="h-4 w-4" /> Aprobar y enviar
                  </button>
                </div>
                <p className="font-body text-[11px] text-gray-400">
                  Aprobar no se salta el portero de WhatsApp: fuera de la ventana de 24 horas, fuera
                  de la jornada o sin consentimiento, el mensaje queda registrado y no sale.
                </p>
              </form>
            ) : (
              <p className="mt-2 font-body text-sm text-gray-500">
                {caso.estado === 'CERRADO'
                  ? 'El caso está cerrado: no se le puede responder.'
                  : !caso.conversacion_id
                    ? 'Este caso no tiene conversación: no hay a dónde responder.'
                    : 'No tienes permiso para responder.'}
              </p>
            )}
          </div>

          {/* ── Estado y asignación ── */}
          {puedeGestionar && caso.estado !== 'CERRADO' && (
            <div className={tarjeta}>
              <h2 className="font-display text-lg font-bold text-gray-900">Mover el caso</h2>
              <form action={(fd) => correr(cambiarEstado, fd)} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="caso_id" value={caso.id} />
                <label className="font-body text-xs text-gray-500">
                  Estado
                  <select name="estado" defaultValue="EN_TRAMITE"
                          className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs">
                    <option value="EN_TRAMITE">En trámite</option>
                    <option value="EN_ESPERA">En espera (para el reloj)</option>
                    <option value="RESUELTO">Resuelto</option>
                    <option value="CERRADO">Cerrado</option>
                  </select>
                </label>
                <label className="flex-1 font-body text-xs text-gray-500">
                  Motivo (obligatorio para cerrar y para poner en espera)
                  <input name="motivo"
                         className="mt-0.5 block w-full rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                </label>
                <button type="submit" disabled={enCurso}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 font-body text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  Cambiar estado
                </button>
              </form>
              <p className="mt-1 font-body text-[11px] text-gray-400">
                <strong>En espera</strong> para el reloj de resolución, y solo se puede después de
                haber contestado por primera vez: para esperar algo de la otra parte hay que
                habérselo preguntado. Mientras está en pausa, el caso no puede quedar incumplido.
              </p>

              <form action={(fd) => correr(asignarCaso, fd)} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="caso_id" value={caso.id} />
                <label className="font-body text-xs text-gray-500">
                  <span className="flex items-center gap-1"><UserPlus className="h-3 w-3" /> Agente</span>
                  <select name="usuario_id" defaultValue={caso.asignado_a ?? ''}
                          className="mt-0.5 block w-52 rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs">
                    <option value="">— sin asignar —</option>
                    {agentes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </label>
                <input name="motivo" placeholder="Motivo del pase"
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                <button type="submit" disabled={enCurso}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 font-body text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  Asignar
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ── Historial ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={tarjeta}>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gray-900">
            <UserPlus className="h-4 w-4" /> A quién le ha tocado
          </h2>
          {asignaciones.length === 0 ? (
            <p className="mt-2 font-body text-sm text-gray-500">Nunca se asignó.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {asignaciones.map((a) => (
                <li key={a.id} className="border-b border-gray-100 py-1 font-body text-xs last:border-0">
                  <span className="font-semibold text-gray-800">{a.usuario_nombre ?? '(cuenta borrada)'}</span>
                  <span className="text-gray-400">
                    {' · '}{hora(a.desde)}{a.hasta ? ` → ${hora(a.hasta)}` : ' → vigente'}
                  </span>
                  {a.motivo && <div className="text-gray-500">{a.motivo}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={tarjeta}>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gray-900">
            <History className="h-4 w-4" /> Auditoría
          </h2>
          <p className="mt-1 font-body text-[11px] text-gray-400">
            De `ronda_eventos`, que solo se agrega: la RLS no concede UPDATE ni DELETE.
          </p>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {eventos.map((e) => (
              <li key={e.id} className="border-b border-gray-100 py-1 font-body text-xs last:border-0">
                <span className="font-mono text-[11px] font-semibold text-gray-700">{e.accion}</span>
                <span className="text-gray-400">
                  {' · '}{e.actor_tipo.toLowerCase()}{e.actor_nombre ? ` ${e.actor_nombre}` : ''}
                  {' · '}{hora(e.created_at)}
                </span>
                {e.detalle?.motivo && <div className="text-gray-500">{String(e.detalle.motivo)}</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
