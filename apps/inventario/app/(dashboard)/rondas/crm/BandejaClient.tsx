'use client'

// La bandeja del CRM. Lo que la pantalla tiene que dejar claro de un golpe:
//   1. QUÉ HAY QUE CONTESTAR YA (el reloj, y lo que ya se incumplió).
//   2. QUÉ SUGERENCIA DE LA IA ESPERA QUE ALGUIEN LA APRUEBE. Una sugerencia
//      sin aprobar es trabajo pendiente, no un adorno: nunca sale sola.
//   3. QUÉ NO TIENE DUEÑO (sin asignar), que es lo que se cae entre dos turnos.
//
// Y una decisión heredada de F9 que acá se mantiene: EL NÚMERO DE WHATSAPP NO
// SE MUESTRA COMPLETO. Es dato personal y quien mira la bandeja no lo necesita
// para hacer su trabajo. El buscador SÍ filtra por el número completo, a
// propósito, y el texto del buscador lo dice para que sea una decisión visible.

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Inbox, AlertTriangle, PauseCircle, Sparkles, Search, UserPlus, Clock,
  Tag, SlidersHorizontal, MessageSquarePlus, ShieldCheck, Timer,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatearMinutos, leerSlaCon, type OpcionesHabiles } from '@/lib/crm/sla'
import { abrirCaso, tomarCaso, asignarCaso, guardarEtiqueta, guardarReglaSla } from './actions'

export interface ResumenFila {
  grupo_id: string | null
  casos: number
  nuevos: number
  en_tramite: number
  en_espera: number
  resueltos: number
  cerrados: number
  sin_asignar: number
  sin_contrato: number
  incumplidos: number
  en_pausa: number
  vencen_pronto: number
  sugerencias_por_revisar: number
}

export interface CasoFila {
  id: string
  numero: string
  conversacion_id: string | null
  canal: string
  tipo: string
  estado: 'NUEVO' | 'EN_TRAMITE' | 'EN_ESPERA' | 'RESUELTO' | 'CERRADO'
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'
  grupo_id: string | null
  asunto: string
  asignado_a: string | null
  asignado_nombre: string | null
  abierto_at: string
  updated_at: string
  resumen_ia: string | null
  tipo_ia: string | null
  prioridad_ia: string | null
  ia_confianza: number | null
  ia_generado_at: string | null
  ia_confirmado_at: string | null
  tiene_sugerencia: boolean
  sugerencia_por_aprobar: boolean
  contrato_codigo: string | null
  contrato_nombre: string | null
  sede_nombre: string | null
  wa_id: string | null
  perfil_nombre: string | null
  ultimo_entrante_at: string | null
  sla_prioridad: string | null
  horas_habiles: boolean | null
  sla_arranca_at: string | null
  minutos_primera_respuesta: number | null
  minutos_resolucion: number | null
  jornada_desde: string | null
  jornada_hasta: string | null
  sla_zona: string | null
  resuelto_at: string | null
  vence_primera_at: string | null
  vence_resolucion_at: string | null
  primera_respuesta_at: string | null
  pausado_min: number | null
  pausado_desde: string | null
  pausas: number | null
  incumplido: boolean | null
  incumplido_que: string | null
  reloj_en_pausa: boolean | null
  min_para_primera: number | null
  min_para_resolucion: number | null
  etiquetas: { codigo: string; nombre: string; color: string; origen: string }[]
}

export interface EtiquetaFila {
  id: string
  codigo: string
  nombre: string
  color: string
  grupo_id: string | null
  descripcion: string | null
  activo: boolean
}

export interface ReglaFila {
  id: string
  grupo_id: string | null
  tipo: string | null
  prioridad: string
  minutos_primera_respuesta: number
  minutos_resolucion: number
  horas_habiles: boolean
  jornada_desde: string
  jornada_hasta: string
  activo: boolean
  observacion: string | null
  contrato: { codigo: string; nombre: string } | null
}

export interface AgenteFila { id: string; nombre: string; rol: string }

export interface ConversacionSuelta {
  id: string
  wa_id: string
  perfil_nombre: string | null
  estado: string
  ultimo_entrante_at: string | null
  mensajes_entrantes: number
  contrato: { codigo: string; nombre: string } | null
  tuvoCaso?: boolean
}

const tarjeta = 'rounded-xl border border-gray-200 bg-white p-4'
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-semibold'

/** Un número de WhatsApp nunca se muestra completo: es dato personal, y quien
 *  mira la bandeja no lo necesita para hacer su trabajo (misma decisión de F9). */
function numeroCorto(waId: string | null): string {
  if (!waId) return '—'
  if (waId.length <= 6) return '••••'
  return `${waId.slice(0, 2)}•••••${waId.slice(-3)}`
}

function hora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Bogota',
  })
}

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

/**
 * El reloj de una fila, con la pausa y el incumplimiento al frente.
 *
 * Lo que falta se muestra en MINUTOS HÁBILES, con la misma aritmética que
 * calculó el plazo (`lib/crm/sla.ts`) y el mismo calendario de festivos. La
 * vista trae además los minutos de reloj de pared, pero mostrar «143 h» para un
 * plazo de «4 días hábiles» confunde más de lo que informa.
 */
function Reloj({ c, festivos }: { c: CasoFila; festivos: readonly string[] }) {
  if (c.incumplido) {
    return (
      <span className={`${chip} bg-red-100 text-red-800`} title={`Incumplido: ${c.incumplido_que}`}>
        <AlertTriangle className="h-3 w-3" />
        {c.incumplido_que === 'PRIMERA' ? 'sin contestar a tiempo'
          : c.incumplido_que === 'AMBOS' ? 'vencido (los dos)' : 'sin resolver a tiempo'}
      </span>
    )
  }
  if (c.reloj_en_pausa) {
    return (
      <span className={`${chip} bg-violet-50 text-violet-700`}
            title={`El reloj está parado. Acumula ${c.pausado_min ?? 0} min hábiles en pausa.`}>
        <PauseCircle className="h-3 w-3" /> reloj en pausa
      </span>
    )
  }
  const habiles = c.horas_habiles ?? true
  let min = c.primera_respuesta_at === null ? c.min_para_primera : c.min_para_resolucion
  if (habiles && c.sla_arranca_at && c.minutos_primera_respuesta && c.minutos_resolucion) {
    const opc: OpcionesHabiles = {
      desdeHora: (c.jornada_desde ?? '08:00').slice(0, 5),
      hastaHora: (c.jornada_hasta ?? '17:00').slice(0, 5),
      zona: c.sla_zona ?? 'America/Bogota',
      noHabiles: festivos,
    }
    const r = leerSlaCon({
      arrancaAt: c.sla_arranca_at,
      minutosPrimeraRespuesta: c.minutos_primera_respuesta,
      minutosResolucion: c.minutos_resolucion,
      horasHabiles: true,
      jornadaDesde: opc.desdeHora, jornadaHasta: opc.hastaHora, zona: opc.zona,
      primeraRespuestaAt: c.primera_respuesta_at,
      resueltoAt: c.resuelto_at,
      pausadoMin: c.pausado_min ?? 0,
      pausadoDesde: c.pausado_desde,
    }, new Date(), opc)
    min = c.primera_respuesta_at === null ? r.restaPrimeraMin : r.restaResolucionMin
  }
  const que = c.primera_respuesta_at === null ? 'para contestar' : 'para resolver'
  if (min === null) return <span className="font-body text-xs text-gray-400">—</span>
  const apretado = min <= 60
  const vence = c.primera_respuesta_at === null ? c.vence_primera_at : c.vence_resolucion_at
  return (
    <span className={`${chip} ${apretado ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-600'}`}
          title={habiles
            ? `Tiempo hábil (${(c.jornada_desde ?? '08:00').slice(0, 5)}–${(c.jornada_hasta ?? '17:00').slice(0, 5)}, lun a vie, sin festivos). Vence ${hora(vence)}.`
            : `Reloj de pared, 24/7. Vence ${hora(vence)}.`}>
      <Timer className="h-3 w-3" />
      {formatearMinutos(min, habiles)} {que}
    </span>
  )
}

export function BandejaClient({
  resumen, casos, etiquetas, reglas, agentes, sueltas,
  puedeGestionar, puedeParametrizar, iaEncendida, iaModelo, faltaParaIa, festivos,
}: {
  resumen: ResumenFila[]
  casos: CasoFila[]
  etiquetas: EtiquetaFila[]
  reglas: ReglaFila[]
  agentes: AgenteFila[]
  sueltas: ConversacionSuelta[]
  puedeGestionar: boolean
  puedeParametrizar: boolean
  iaEncendida: boolean
  iaModelo: string
  faltaParaIa: string[]
  /** El calendario COMPARTIDO (`pqrs_dias_no_habiles`), para que el reloj de la
   *  lista cuente en hábiles igual que la base. */
  festivos: string[]
}) {
  const router = useRouter()
  const [pestana, setPestana] = useState<'cola' | 'sugerencias' | 'sueltas' | 'parametros'>('cola')
  const [busca, setBusca] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<string>('ABIERTOS')
  const [mios, setMios] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [enCurso, empezar] = useTransition()

  // Realtime: un caso que abre el bot aparece sin recargar. Es el criterio de
  // aceptación de la Fase 4 del documento 00 («la bandeja muestra un mensaje
  // entrante sin recargar»), y acá vale para el caso y para el mensaje.
  const sb = useMemo(() => createClient(), [])
  useEffect(() => {
    const canal = sb.channel('crm-bandeja')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_casos' },
        () => router.refresh())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_mensajes' },
        () => router.refresh())
      .subscribe()
    return () => { sb.removeChannel(canal) }
  }, [sb, router])

  const total = useMemo(() => {
    const t = {
      casos: 0, nuevos: 0, enTramite: 0, enEspera: 0, sinAsignar: 0,
      incumplidos: 0, enPausa: 0, vencenPronto: 0, sugerencias: 0, sinContrato: 0,
    }
    for (const f of resumen) {
      t.casos += Number(f.casos)
      t.nuevos += Number(f.nuevos)
      t.enTramite += Number(f.en_tramite)
      t.enEspera += Number(f.en_espera)
      t.sinAsignar += Number(f.sin_asignar)
      t.incumplidos += Number(f.incumplidos)
      t.enPausa += Number(f.en_pausa)
      t.vencenPronto += Number(f.vencen_pronto)
      t.sugerencias += Number(f.sugerencias_por_revisar)
      t.sinContrato += Number(f.sin_contrato)
    }
    return t
  }, [resumen])

  const sugerencias = useMemo(() => casos.filter((c) => c.sugerencia_por_aprobar), [casos])

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase()
    return casos.filter((c) => {
      if (filtroEstado === 'ABIERTOS' && !['NUEVO', 'EN_TRAMITE', 'EN_ESPERA'].includes(c.estado)) return false
      if (filtroEstado !== 'ABIERTOS' && filtroEstado !== 'TODOS' && c.estado !== filtroEstado) return false
      if (mios && !c.asignado_a) return false
      if (!q) return true
      // El número COMPLETO sí se puede buscar, aunque no se muestre: un
      // supervisor que lo tiene en la mano necesita encontrar el caso.
      return (
        c.numero.toUpperCase().includes(q) ||
        c.asunto.toUpperCase().includes(q) ||
        (c.wa_id ?? '').includes(q) ||
        (c.perfil_nombre ?? '').toUpperCase().includes(q) ||
        (c.contrato_codigo ?? '').toUpperCase().includes(q) ||
        (c.asignado_nombre ?? '').toUpperCase().includes(q) ||
        c.etiquetas.some((e) => e.codigo.includes(q))
      )
    })
  }, [casos, busca, filtroEstado, mios])

  function correr(fn: (fd: FormData) => Promise<{ error?: string; ok?: boolean; aviso?: string }>, fd: FormData) {
    empezar(async () => {
      const r = await fn(fd)
      if (r.error) setAviso({ tipo: 'error', texto: r.error })
      else setAviso({ tipo: 'ok', texto: r.aviso ?? 'Hecho.' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* ── Cabecera ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">Bandeja del CRM</h1>
          <p className="font-body text-sm text-gray-500">
            Los casos que salen de las conversaciones de WhatsApp, con su agente, su reloj
            y lo que la IA sugiere. Una respuesta sugerida nunca sale sola: la aprueba una persona.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${chip} ${iaEncendida ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>
            <Sparkles className="h-3 w-3" />
            {iaEncendida ? `IA encendida · ${iaModelo}` : 'IA apagada'}
          </span>
        </div>
      </div>

      {/* Qué le falta al entorno para que la IA funcione. Acá es más útil que
          como un error en el momento de pulsar el botón. */}
      {!iaEncendida && faltaParaIa.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 font-body text-sm text-amber-900">
          <strong>La IA del CRM está apagada.</strong> Falta en el entorno:{' '}
          {faltaParaIa.map((v, i) => (
            <span key={v}>{i > 0 && ', '}<code className="rounded bg-amber-100 px-1">{v}</code></span>
          ))}
          . Sin eso la bandeja, los casos y el SLA funcionan igual: la IA es comodidad, no cimiento.
        </div>
      )}

      {aviso && (
        <div className={`rounded-xl border p-3 font-body text-sm ${
          aviso.tipo === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-red-200 bg-red-50 text-red-900'}`}>
          {aviso.texto}
          <button type="button" onClick={() => setAviso(null)}
                  className="ml-2 underline">cerrar</button>
        </div>
      )}

      {/* ── Tarjetas, todas contadas en SQL ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icono={<Inbox className="h-4 w-4" />} rotulo="Abiertos"
             valor={total.nuevos + total.enTramite + total.enEspera}
             detalle={`${total.nuevos} nuevos`} />
        <Kpi icono={<AlertTriangle className="h-4 w-4" />} rotulo="SLA incumplido"
             valor={total.incumplidos} tono={total.incumplidos > 0 ? 'rojo' : 'gris'}
             detalle="ya pasó el tope" />
        <Kpi icono={<Clock className="h-4 w-4" />} rotulo="Vencen pronto"
             valor={total.vencenPronto} tono={total.vencenPronto > 0 ? 'ambar' : 'gris'}
             detalle="sin contestar, menos de 8 h" />
        <Kpi icono={<UserPlus className="h-4 w-4" />} rotulo="Sin asignar"
             valor={total.sinAsignar} tono={total.sinAsignar > 0 ? 'ambar' : 'gris'}
             detalle="nadie los tiene" />
        <Kpi icono={<Sparkles className="h-4 w-4" />} rotulo="Sugerencias"
             valor={total.sugerencias} tono={total.sugerencias > 0 ? 'violeta' : 'gris'}
             detalle="esperan aprobación" />
        <Kpi icono={<PauseCircle className="h-4 w-4" />} rotulo="Reloj en pausa"
             valor={total.enPausa} detalle="esperando a la otra parte" />
      </div>

      {total.sinContrato > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 font-body text-sm text-sky-900">
          Hay <strong>{total.sinContrato}</strong> caso(s) sin contrato: son conversaciones de
          números que todavía no se identificaron. Los ve solo quien gestiona el CRM, porque no
          hay alcance con el que filtrarlos.
        </div>
      )}

      {/* ── Pestañas ── */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {([
          ['cola', `Cola (${filtrados.length})`],
          ['sugerencias', `Sugerencias por aprobar (${sugerencias.length})`],
          ['sueltas', `Conversaciones sin caso (${sueltas.length})`],
          ['parametros', 'Etiquetas y SLA'],
        ] as const).map(([id, rotulo]) => (
          <button key={id} type="button" onClick={() => setPestana(id)}
                  className={`-mb-px border-b-2 px-3 py-2 font-body text-sm font-semibold ${
                    pestana === id
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {rotulo}
          </button>
        ))}
      </div>

      {/* ── Cola ── */}
      {pestana === 'cola' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                     placeholder="Buscar por caso, asunto, contrato, agente, etiqueta o el número completo"
                     className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 font-body text-sm" />
            </div>
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 font-body text-sm">
              <option value="ABIERTOS">Abiertos</option>
              <option value="NUEVO">Nuevos</option>
              <option value="EN_TRAMITE">En trámite</option>
              <option value="EN_ESPERA">En espera</option>
              <option value="RESUELTO">Resueltos</option>
              <option value="CERRADO">Cerrados</option>
              <option value="TODOS">Todos</option>
            </select>
            <label className="flex items-center gap-2 font-body text-sm text-gray-600">
              <input type="checkbox" checked={mios} onChange={(e) => setMios(e.target.checked)} />
              Solo asignados
            </label>
          </div>

          {filtrados.length === 0 ? (
            <div className={`${tarjeta} text-center font-body text-sm text-gray-500`}>
              {busca.trim() || filtroEstado !== 'ABIERTOS' || mios
                ? 'Ningún caso coincide con el filtro.'
                : 'No hay casos abiertos. Cuando el bot derive una conversación a un agente, aparece acá.'}
            </div>
          ) : (
            <div className={`${tarjeta} overflow-x-auto p-0`}>
              <table className="w-full text-left">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Caso</th>
                    <th className="px-3 py-2">Asunto</th>
                    <th className="px-3 py-2">Contrato</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Reloj</th>
                    <th className="px-3 py-2">Agente</th>
                    <th className="px-3 py-2">IA</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2 align-top">
                        <Link href={`/rondas/crm/${c.id}`}
                              className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                          {c.numero}
                        </Link>
                        <div className="font-body text-[11px] text-gray-400">{hora(c.abierto_at)}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-body text-sm text-gray-800">{c.asunto}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className={`${chip} ${COLOR_PRIORIDAD[c.prioridad]}`}>{c.prioridad}</span>
                          <span className={`${chip} bg-gray-100 text-gray-600`}>{c.tipo}</span>
                          {c.etiquetas.map((e) => (
                            <span key={e.codigo} className={`${chip} ring-1 ring-inset`}
                                  style={{ color: e.color, borderColor: e.color }}
                                  title={e.origen === 'IA' ? `${e.nombre} — la sugirió la IA` : e.nombre}>
                              <Tag className="h-3 w-3" />{e.codigo}
                              {e.origen === 'IA' && <Sparkles className="h-2.5 w-2.5" />}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top font-body text-xs text-gray-600">
                        {c.contrato_codigo ?? <span className="text-amber-700">sin identificar</span>}
                        <div className="text-[11px] text-gray-400">{c.sede_nombre ?? ''}</div>
                        <div className="font-mono text-[11px] text-gray-400">{numeroCorto(c.wa_id)}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`${chip} ${COLOR_ESTADO[c.estado]}`}>{c.estado.replace('_', ' ')}</span>
                      </td>
                      <td className="px-3 py-2 align-top"><Reloj c={c} festivos={festivos} /></td>
                      <td className="px-3 py-2 align-top font-body text-xs text-gray-700">
                        {c.asignado_nombre ?? <span className="text-amber-700">sin asignar</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {c.sugerencia_por_aprobar ? (
                          <span className={`${chip} bg-violet-50 text-violet-700`}>
                            <Sparkles className="h-3 w-3" /> por aprobar
                          </span>
                        ) : c.ia_confirmado_at ? (
                          <span className={`${chip} bg-emerald-50 text-emerald-700`}>
                            <ShieldCheck className="h-3 w-3" /> confirmada
                          </span>
                        ) : c.ia_generado_at ? (
                          <span className={`${chip} bg-gray-100 text-gray-600`}>analizado</span>
                        ) : (
                          <span className="font-body text-[11px] text-gray-400">sin analizar</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        {puedeGestionar && !c.asignado_a && c.estado !== 'CERRADO' && (
                          <button type="button" disabled={enCurso}
                                  onClick={() => {
                                    const fd = new FormData()
                                    fd.set('caso_id', c.id)
                                    correr(tomarCaso, fd)
                                  }}
                                  className="rounded-lg border border-gray-300 px-2 py-1 font-body text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                            Lo tomo yo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Sugerencias por aprobar ── */}
      {pestana === 'sugerencias' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 font-body text-sm text-violet-900">
            <strong>Esto no son respuestas enviadas: son borradores.</strong> La IA redactó un texto
            y lo dejó esperando. No sale nada hasta que una persona lo abra, lo lea, lo corrija si
            hace falta y le dé al botón. Es la regla del ADR-02 §4, y está puesta en la base de
            datos, no solo en esta pantalla.
          </div>
          {sugerencias.length === 0 ? (
            <div className={`${tarjeta} text-center font-body text-sm text-gray-500`}>
              No hay sugerencias esperando aprobación.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {sugerencias.map((c) => (
                <div key={c.id} className={tarjeta}>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/rondas/crm/${c.id}`}
                          className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                      {c.numero}
                    </Link>
                    <span className={`${chip} ${COLOR_PRIORIDAD[c.prioridad]}`}>{c.prioridad}</span>
                  </div>
                  <div className="mt-1 font-body text-sm font-semibold text-gray-800">{c.asunto}</div>
                  {c.resumen_ia && (
                    <p className="mt-2 border-l-2 border-violet-300 pl-2 font-body text-xs text-gray-600">
                      {c.resumen_ia}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-body text-[11px] text-gray-400">
                      {c.ia_confianza !== null && `confianza ${Math.round(Number(c.ia_confianza) * 100)}% · `}
                      {hora(c.ia_generado_at)}
                    </span>
                    <Link href={`/rondas/crm/${c.id}`}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 font-body text-xs font-semibold text-white hover:bg-brand-700">
                      Revisar y decidir
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Conversaciones sin caso ── */}
      {pestana === 'sueltas' && (
        <div className="space-y-3">
          <p className="font-body text-sm text-gray-500">
            Conversaciones con movimiento reciente que no tienen un caso abierto. El bot abre un
            caso cuando deriva a un agente o avisa a un supervisor; de acá se abre a mano lo que
            el bot resolvió solo pero alguien quiere seguir.
          </p>
          {sueltas.length === 0 ? (
            <div className={`${tarjeta} text-center font-body text-sm text-gray-500`}>
              Todas las conversaciones recientes ya tienen caso.
            </div>
          ) : (
            <div className={`${tarjeta} overflow-x-auto p-0`}>
              <table className="w-full text-left">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Número</th>
                    <th className="px-3 py-2">Contrato</th>
                    <th className="px-3 py-2">Estado del bot</th>
                    <th className="px-3 py-2">Último entrante</th>
                    <th className="px-3 py-2">Entrantes</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sueltas.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">
                        {numeroCorto(s.wa_id)}
                        <div className="font-body text-[11px] text-gray-400">
                          {s.perfil_nombre ?? 'sin nombre de perfil'}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-body text-xs text-gray-600">
                        {s.contrato?.codigo ?? <span className="text-amber-700">sin identificar</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`${chip} bg-gray-100 text-gray-600`}>
                          {s.estado.replaceAll('_', ' ').toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-body text-xs text-gray-600">{hora(s.ultimo_entrante_at)}</td>
                      <td className="px-3 py-2 font-body text-xs text-gray-600">{s.mensajes_entrantes}</td>
                      <td className="px-3 py-2 text-right">
                        {puedeGestionar && (
                          <form action={(fd) => correr(abrirCaso, fd)} className="inline-flex items-center gap-1">
                            <input type="hidden" name="conversacion_id" value={s.id} />
                            <input type="hidden" name="asunto" value="Caso abierto desde la bandeja" />
                            <input type="hidden" name="motivo" value="ABIERTO_EN_CONSOLA" />
                            <select name="prioridad"
                                    className="rounded-lg border border-gray-300 px-2 py-1 font-body text-xs">
                              <option value="MEDIA">Media</option>
                              <option value="ALTA">Alta</option>
                              <option value="CRITICA">Crítica</option>
                              <option value="BAJA">Baja</option>
                            </select>
                            <button type="submit" disabled={enCurso}
                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 font-body text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                              <MessageSquarePlus className="h-3 w-3" /> Abrir caso
                            </button>
                          </form>
                        )}
                        {s.tuvoCaso && (
                          <div className="font-body text-[11px] text-gray-400">ya tuvo un caso cerrado</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Etiquetas y reglas de SLA ── */}
      {pestana === 'parametros' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={tarjeta}>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gray-900">
              <Tag className="h-4 w-4" /> Etiquetas
            </h2>
            <p className="mt-1 font-body text-xs text-gray-500">
              Una etiqueta sin contrato aplica a todos. Las que sugiere la IA llevan su marca y
              dejan de ser sugerencia cuando una persona las confirma.
            </p>
            <ul className="mt-3 space-y-1">
              {etiquetas.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 border-b border-gray-100 py-1 last:border-0">
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="font-mono text-xs text-gray-700">{e.codigo}</span>
                    <span className="font-body text-xs text-gray-500">{e.nombre}</span>
                  </span>
                  <span className="font-body text-[11px] text-gray-400">
                    {e.grupo_id ? 'de un contrato' : 'general'}{!e.activo && ' · inactiva'}
                  </span>
                </li>
              ))}
            </ul>
            {puedeParametrizar && (
              <form action={(fd) => correr(guardarEtiqueta, fd)} className="mt-3 grid grid-cols-2 gap-2">
                <input name="codigo" placeholder="CODIGO" required
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-mono text-xs uppercase" />
                <input name="nombre" placeholder="Nombre visible" required
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                <input name="color" type="color" defaultValue="#64748B"
                       className="h-8 rounded-lg border border-gray-300" />
                <button type="submit" disabled={enCurso}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 font-body text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                  Agregar etiqueta
                </button>
              </form>
            )}
          </div>

          <div className={tarjeta}>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-gray-900">
              <SlidersHorizontal className="h-4 w-4" /> Reglas de SLA
            </h2>
            <p className="mt-1 font-body text-xs text-gray-500">
              Los plazos corren en <strong>tiempo hábil</strong>, con el calendario de festivos que
              ya comparten PQRS y No conformes. Cambiar un tope aplica a lo que se abra después:
              los casos abiertos conservan el plazo con el que nacieron.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-gray-200">
                  <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="py-1 pr-2">Ámbito</th>
                    <th className="py-1 pr-2">Prioridad</th>
                    <th className="py-1 pr-2">Contestar</th>
                    <th className="py-1 pr-2">Resolver</th>
                    <th className="py-1">Franja</th>
                  </tr>
                </thead>
                <tbody>
                  {reglas.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-1 pr-2 font-body text-xs text-gray-600">
                        {r.contrato?.codigo ?? 'por defecto'}{r.tipo ? ` · ${r.tipo}` : ''}
                        {!r.activo && ' · inactiva'}
                      </td>
                      <td className="py-1 pr-2">
                        <span className={`${chip} ${COLOR_PRIORIDAD[r.prioridad]}`}>{r.prioridad}</span>
                      </td>
                      <td className="py-1 pr-2 font-body text-xs text-gray-700">
                        {formatearMinutos(r.minutos_primera_respuesta, r.horas_habiles)}
                      </td>
                      <td className="py-1 pr-2 font-body text-xs text-gray-700">
                        {formatearMinutos(r.minutos_resolucion, r.horas_habiles)}
                      </td>
                      <td className="py-1 font-body text-[11px] text-gray-500">
                        {r.horas_habiles
                          ? `${r.jornada_desde.slice(0, 5)}–${r.jornada_hasta.slice(0, 5)} hábiles`
                          : '24/7'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {puedeParametrizar && (
              <form action={(fd) => correr(guardarReglaSla, fd)} className="mt-3 grid grid-cols-2 gap-2">
                <select name="prioridad" className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs">
                  <option value="CRITICA">Crítica</option>
                  <option value="ALTA">Alta</option>
                  <option value="MEDIA">Media</option>
                  <option value="BAJA">Baja</option>
                </select>
                <select name="tipo" className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs">
                  <option value="">Cualquier tipo</option>
                  {['CONSULTA', 'VISITA', 'PQRS', 'MANTENIMIENTO', 'SOPORTE', 'IDENTIDAD',
                    'CONSENTIMIENTO', 'ADMINISTRATIVO', 'OTRO'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input name="minutos_primera_respuesta" type="number" min={5} placeholder="Min. contestar" required
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                <input name="minutos_resolucion" type="number" min={5} placeholder="Min. resolver" required
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                <input name="jornada_desde" type="time" defaultValue="08:00"
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                <input name="jornada_hasta" type="time" defaultValue="17:00"
                       className="rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs" />
                <button type="submit" disabled={enCurso}
                        className="col-span-2 rounded-lg bg-brand-600 px-3 py-1.5 font-body text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                  Guardar regla
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Asignación masiva: el atajo de un coordinador que reparte la cola. */}
      {pestana === 'cola' && puedeGestionar && agentes.length > 0 && filtrados.some((c) => !c.asignado_a) && (
        <div className={`${tarjeta} flex flex-wrap items-end gap-2`}>
          <form action={(fd) => correr(asignarCaso, fd)} className="flex flex-wrap items-end gap-2">
            <label className="font-body text-xs text-gray-600">
              Pasar un caso a otra persona
              <select name="caso_id" required
                      className="mt-1 block w-56 rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs">
                {filtrados.filter((c) => c.estado !== 'CERRADO').map((c) => (
                  <option key={c.id} value={c.id}>{c.numero} — {c.asunto.slice(0, 40)}</option>
                ))}
              </select>
            </label>
            <label className="font-body text-xs text-gray-600">
              Agente
              <select name="usuario_id"
                      className="mt-1 block w-48 rounded-lg border border-gray-300 px-2 py-1.5 font-body text-xs">
                <option value="">— devolver a la bolsa común —</option>
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
  )
}

function Kpi({ icono, rotulo, valor, detalle, tono = 'gris' }: {
  icono: React.ReactNode
  rotulo: string
  valor: number
  detalle?: string
  tono?: 'gris' | 'rojo' | 'ambar' | 'violeta'
}) {
  const colores = {
    gris: 'text-gray-500',
    rojo: 'text-red-700',
    ambar: 'text-orange-700',
    violeta: 'text-violet-700',
  }[tono]
  return (
    <div className={tarjeta}>
      <div className={`flex items-center gap-1 font-body text-[11px] uppercase tracking-wide ${colores}`}>
        {icono}{rotulo}
      </div>
      <div className="mt-1 font-display text-2xl font-bold text-gray-900">{valor}</div>
      {detalle && <div className="font-body text-[11px] text-gray-400">{detalle}</div>}
    </div>
  )
}
