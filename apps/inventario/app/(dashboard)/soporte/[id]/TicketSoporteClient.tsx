'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Camera, Paperclip, Globe, User, Monitor, Terminal, Network, MousePointerClick, AlertCircle, CheckCircle2, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  ESTADO_SOPORTE_META, PRIORIDAD_SOPORTE_META, PRIORIDADES_SOPORTE, TIPO_SOPORTE_META, MAX_ADJUNTO_SOPORTE,
  accionesDisponibles, copiarTexto, fechaHoraSoporte as fechaHora, ZONA_SOPORTE, firmarRutasSoporte, subirArchivoSoporte,
  type AdjuntoSubido, type EstadoSoporte, type SoporteMensaje, type SoporteTicket,
} from '@/lib/soporte'
import { construirPrompt } from '@/lib/soporte/prompt'
import { ChatSoporte } from './ChatSoporte'

type Pestana = 'errores' | 'consola' | 'red' | 'acciones' | 'entorno'

export function TicketSoporteClient({ ticket: inicial, mensajes: mensajesIniciales, agentes, usuarioId, agente }: {
  ticket: SoporteTicket
  mensajes: SoporteMensaje[]
  agentes: { id: string; nombre: string; rol_nombre: string | null }[]
  usuarioId: string
  agente: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [ticket, setTicket] = useState(inicial)
  const [mensajes, setMensajes] = useState(mensajesIniciales)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [pestana, setPestana] = useState<Pestana>((inicial.contexto?.errores?.length ?? 0) > 0 ? 'errores' : 'acciones')
  const [copiando, setCopiando] = useState(false)

  useEffect(() => { setTicket(inicial) }, [inicial])

  const agregar = useCallback((m: SoporteMensaje) => {
    setMensajes((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort((a, b) => a.created_at.localeCompare(b.created_at)))
  }, [])

  // En vivo: mensajes nuevos y cambios del ticket.
  useEffect(() => {
    const canal = sb.channel(`soporte:${ticket.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soporte_mensajes', filter: `ticket_id=eq.${ticket.id}` },
        (p: { new: SoporteMensaje }) => agregar(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'soporte_tickets', filter: `id=eq.${ticket.id}` },
        (p: { new: SoporteTicket }) => setTicket((t) => ({ ...t, ...p.new })))
      .subscribe()
    return () => { sb.removeChannel(canal) }
  }, [sb, ticket.id, agregar])

  // Firmar captura y adjuntos (una vez por ruta).
  const firmadasRef = useRef(new Set<string>())
  useEffect(() => {
    const rutas = [ticket.captura_path, ...mensajes.map((m) => m.adjunto_path)]
      .filter((p): p is string => !!p && !firmadasRef.current.has(p))
    if (rutas.length === 0) return
    rutas.forEach((p) => firmadasRef.current.add(p))
    firmarRutasSoporte(sb, rutas).then((u) => setUrls((prev) => ({ ...prev, ...u })))
  }, [mensajes, ticket.captura_path, sb])

  async function copiarPrompt() {
    setCopiando(true)
    try {
      // Enlaces de 7 días para que la IA (o quien lo lea) pueda abrir la evidencia.
      const rutas = [ticket.captura_path, ...mensajes.map((m) => m.adjunto_path)].filter((p): p is string => !!p)
      const enlaces = await firmarRutasSoporte(sb, rutas, 7 * 24 * 3600)
      const texto = construirPrompt({
        numero: ticket.numero, tipo: ticket.tipo, prioridad: ticket.prioridad, estado: ticket.estado,
        titulo: ticket.titulo, descripcion: ticket.descripcion, modulo: ticket.modulo, ruta: ticket.ruta,
        reportado: ticket.reportado_nombre, asignado: ticket.asignado_nombre, solucion: ticket.solucion,
        creado: ticket.created_at, contexto: ticket.contexto ?? {}, mensajes, enlaces,
        capturaPath: ticket.captura_path, urlTicket: `${location.origin}/soporte/${ticket.id}`,
      })
      if (await copiarTexto(texto)) toast.success('Prompt copiado con todo el ticket. Pégalo en Claude u otro chat.')
      else toast.error('No se pudo copiar al portapapeles.')
    } finally { setCopiando(false) }
  }

  const c = ticket.contexto ?? {}
  const fallidas = (c.red ?? []).filter((r) => r.estado === null || r.estado >= 400)
  const cerrado = ticket.estado === 'CERRADO' || ticket.estado === 'CANCELADO'
  const capturaUrl = ticket.captura_path ? urls[ticket.captura_path] : null

  const pestanas: { k: Pestana; label: string; icon: typeof Terminal; n?: number; alerta?: boolean }[] = [
    { k: 'errores', label: 'Errores', icon: AlertCircle, n: c.errores?.length ?? 0, alerta: (c.errores?.length ?? 0) > 0 },
    { k: 'acciones', label: 'Pasos', icon: MousePointerClick, n: c.acciones?.length ?? 0 },
    { k: 'consola', label: 'Consola', icon: Terminal, n: c.consola?.length ?? 0 },
    { k: 'red', label: 'Red', icon: Network, n: c.red?.length ?? 0, alerta: fallidas.length > 0 },
    { k: 'entorno', label: 'Entorno', icon: Monitor },
  ]
  const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour12: false, timeZone: ZONA_SOPORTE })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4 min-w-0">
        {/* Cabecera */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm text-gray-400">{ticket.numero}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIPO_SOPORTE_META[ticket.tipo]?.cls}`}>{TIPO_SOPORTE_META[ticket.tipo]?.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_SOPORTE_META[ticket.estado]?.cls}`}>{ESTADO_SOPORTE_META[ticket.estado]?.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORIDAD_SOPORTE_META[ticket.prioridad]?.cls}`}>{PRIORIDAD_SOPORTE_META[ticket.prioridad]?.label}</span>
            <button onClick={copiarPrompt} disabled={copiando}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
              title="Copia todo el ticket (datos técnicos, chat, evidencia) como prompt para Claude u otra IA">
              {copiando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />} Copiar prompt para IA
            </button>
          </div>
          <h1 className="font-heading text-xl font-bold text-gray-900">{ticket.titulo}</h1>
          {ticket.descripcion && <p className="whitespace-pre-wrap text-sm text-gray-700">{ticket.descripcion}</p>}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex gap-1.5"><Globe className="w-3.5 h-3.5 text-gray-400 mt-0.5" /><dt className="text-gray-500">Dónde:</dt><dd className="min-w-0 truncate text-gray-800">{ticket.modulo ?? '—'} · <span className="font-mono">{ticket.ruta}</span></dd></div>
            <div className="flex gap-1.5"><User className="w-3.5 h-3.5 text-gray-400 mt-0.5" /><dt className="text-gray-500">Reportó:</dt><dd className="text-gray-800">{ticket.reportado_nombre ?? '—'}{c.usuario?.rol_nombre ? ` (${c.usuario.rol_nombre})` : ''}{c.usuario?.sede ? ` · ${c.usuario.sede}` : ''}</dd></div>
            <div className="flex gap-1.5"><dt className="text-gray-500 pl-5">Creado:</dt><dd className="text-gray-800">{fechaHora(ticket.created_at)}</dd></div>
            <div className="flex gap-1.5"><dt className="text-gray-500 pl-5">Atiende:</dt><dd className="text-gray-800">{ticket.asignado_nombre ?? 'Sin asignar'}</dd></div>
            {ticket.resuelto_at && <div className="flex gap-1.5"><dt className="text-gray-500 pl-5">Resuelto:</dt><dd className="text-gray-800">{fechaHora(ticket.resuelto_at)}</dd></div>}
            {ticket.cerrado_at && <div className="flex gap-1.5"><dt className="text-gray-500 pl-5">Cerrado:</dt><dd className="text-gray-800">{fechaHora(ticket.cerrado_at)}</dd></div>}
          </dl>
          {ticket.solucion && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><CheckCircle2 className="w-4 h-4" /> Solución</p>
              <p className="mt-0.5 whitespace-pre-wrap">{ticket.solucion}</p>
            </div>
          )}
        </div>

        <CambioEstado ticket={ticket} sb={sb} agente={agente} esAutor={ticket.reportado_por === usuarioId} agentes={agentes}
          onHecho={(t) => { setTicket((prev) => ({ ...prev, ...t })); router.refresh() }} />

        {/* Captura */}
        {ticket.captura_path && (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-heading text-sm font-semibold text-gray-900">Captura al momento del reporte</h2>
            {capturaUrl ? (
              <a href={capturaUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturaUrl} alt="Captura de pantalla" className="w-full rounded-lg border border-gray-100" />
              </a>
            ) : <div className="h-48 rounded-lg bg-gray-100 animate-pulse" />}
          </div>
        )}

        {/* Datos técnicos */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex overflow-x-auto border-b border-gray-100">
            {pestanas.map((p) => (
              <button key={p.k} onClick={() => setPestana(p.k)}
                className={`flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 ${pestana === p.k ? 'border-brand-green text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <p.icon className={`w-3.5 h-3.5 ${p.alerta ? 'text-red-500' : ''}`} /> {p.label}
                {p.n !== undefined && <span className={`rounded-full px-1.5 text-[10px] ${p.alerta ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{p.n}</span>}
              </button>
            ))}
          </div>
          <div className="max-h-[480px] overflow-auto p-3">
            {pestana === 'errores' && (
              <Log vacio="No se registraron errores en la consola." lineas={(c.errores ?? []).map((e) => ({ t: hora(e.t), etiqueta: e.nivel, texto: e.texto, rojo: true }))} />
            )}
            {pestana === 'consola' && (
              <Log vacio="Sin registros de consola." lineas={(c.consola ?? []).map((e) => ({ t: hora(e.t), etiqueta: e.nivel, texto: e.texto, rojo: ['error', 'uncaught', 'promise'].includes(e.nivel), ambar: e.nivel === 'warn' }))} />
            )}
            {pestana === 'red' && (
              <Log vacio="Sin peticiones registradas." lineas={(c.red ?? []).map((r) => ({
                t: hora(r.t), etiqueta: String(r.estado ?? 'ERR'), texto: `${r.metodo} ${r.url} · ${r.ms} ms${r.error ? ` · ${r.error}` : ''}`,
                rojo: r.estado === null || r.estado >= 400,
              }))} />
            )}
            {pestana === 'acciones' && (
              <Log vacio="Sin acciones registradas." lineas={(c.acciones ?? []).map((a) => ({ t: hora(a.t), etiqueta: a.tipo, texto: a.detalle }))} />
            )}
            {pestana === 'entorno' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Tabla titulo="Usuario" datos={c.usuario as Record<string, unknown>} />
                <Tabla titulo="Página" datos={{ url: c.url, titulo: c.titulo_pagina, referrer: c.referrer, modulo: c.modulo, version: c.version, capturado: c.capturado_at }} />
                <Tabla titulo="Navegador" datos={c.navegador} />
                <Tabla titulo="Pantalla" datos={c.pantalla} />
                <Tabla titulo="Rendimiento" datos={c.rendimiento} />
                <Tabla titulo="Almacenamiento (claves)" datos={c.almacenamiento ? { localStorage: c.almacenamiento.local.join(', '), sessionStorage: c.almacenamiento.session.join(', ') } : undefined} />
              </div>
            )}
          </div>
        </div>
      </div>

      <ChatSoporte sb={sb} ticketId={ticket.id} usuarioId={usuarioId} mensajes={mensajes} urls={urls} cerrado={cerrado} onNuevo={agregar} />
    </div>
  )
}

function Log({ lineas, vacio }: { lineas: { t: string; etiqueta: string; texto: string; rojo?: boolean; ambar?: boolean }[]; vacio: string }) {
  if (lineas.length === 0) return <p className="py-6 text-center text-sm text-gray-400">{vacio}</p>
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {lineas.map((l, i) => (
        <div key={i} className={`flex gap-2 border-b border-gray-50 py-1 ${l.rojo ? 'bg-red-50/60 text-red-800' : l.ambar ? 'bg-amber-50/60 text-amber-800' : 'text-gray-700'}`}>
          <span className="shrink-0 text-gray-400">{l.t}</span>
          <span className="w-16 shrink-0 font-semibold uppercase">{l.etiqueta}</span>
          <span className="min-w-0 whitespace-pre-wrap break-all">{l.texto}</span>
        </div>
      ))}
    </div>
  )
}

function Tabla({ titulo, datos }: { titulo: string; datos?: Record<string, unknown> | null }) {
  const filas = Object.entries(datos ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <h3 className="mb-1.5 text-xs font-semibold text-gray-700">{titulo}</h3>
      {filas.length === 0 ? <p className="text-xs text-gray-400">—</p> : (
        <dl className="space-y-0.5 text-[11px]">
          {filas.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-28 shrink-0 text-gray-500">{k}</dt>
              <dd className="min-w-0 break-all text-gray-800">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Cambio de estado con comentario y evidencia (fotos / video / archivos). */
function CambioEstado({ ticket, sb, agente, esAutor, agentes, onHecho }: {
  ticket: SoporteTicket
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  agente: boolean
  esAutor: boolean
  agentes: { id: string; nombre: string; rol_nombre: string | null }[]
  onHecho: (t: SoporteTicket) => void
}) {
  const acciones = accionesDisponibles(ticket.estado, agente, esAutor)
  const [destino, setDestino] = useState<EstadoSoporte | ''>('')
  const [comentario, setComentario] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [asignado, setAsignado] = useState('')
  const [prioridad, setPrioridad] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [paso, setPaso] = useState('')

  if (acciones.length === 0 && !agente) return null
  const accion = acciones.find((a) => a.estado === destino)

  function elegir(lista: FileList | null) {
    if (!lista) return
    const ok = Array.from(lista).filter((f) => {
      if (f.size > MAX_ADJUNTO_SOPORTE) { toast.error(`"${f.name}" supera 50 MB.`); return false }
      return true
    })
    setArchivos((prev) => [...prev, ...ok].slice(0, 6))
  }

  async function aplicar() {
    const estado = destino || ticket.estado
    if (!destino && !asignado && !prioridad) { toast.error('Elige un nuevo estado, un responsable o una prioridad.'); return }
    if (accion?.comentario && !comentario.trim()) { toast.error('Escribe el comentario: qué se cambió o por qué.'); return }
    setEnviando(true)
    try {
      const adjuntos: AdjuntoSubido[] = []
      for (let i = 0; i < archivos.length; i++) {
        setPaso(`Subiendo evidencia ${i + 1} de ${archivos.length}…`)
        adjuntos.push(await subirArchivoSoporte(sb, ticket.id, archivos[i], archivos[i].name))
      }
      setPaso('Guardando…')
      const { data, error } = await sb.rpc('soporte_cambiar_estado', {
        p_ticket: ticket.id, p_estado: estado, p_comentario: comentario.trim() || null,
        p_adjuntos: adjuntos, p_asignado: asignado || null, p_prioridad: prioridad || null,
      })
      if (error) throw new Error(error.message)
      toast.success('Ticket actualizado.')
      setDestino(''); setComentario(''); setArchivos([]); setAsignado(''); setPrioridad('')
      onHecho(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.')
    } finally { setEnviando(false); setPaso('') }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
      <h2 className="font-heading text-sm font-semibold text-gray-900">{agente ? 'Atender ticket' : 'Acciones'}</h2>
      <div className="flex flex-wrap gap-1.5">
        {acciones.map((a) => (
          <button key={a.estado} onClick={() => setDestino(destino === a.estado ? '' : a.estado)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${destino === a.estado ? 'bg-gray-900 text-white' : `${ESTADO_SOPORTE_META[a.estado].cls.replace('line-through', '')} hover:opacity-80`}`}>
            {a.label}
          </button>
        ))}
      </div>
      {agente && (
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={asignado} onChange={(e) => setAsignado(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="">Responsable: {ticket.asignado_nombre ?? 'sin asignar'}</option>
            {agentes.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.rol_nombre ? ` · ${a.rol_nombre}` : ''}</option>)}
          </select>
          <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="">Prioridad: {PRIORIDAD_SOPORTE_META[ticket.prioridad]?.label}</option>
            {PRIORIDADES_SOPORTE.map((p) => <option key={p} value={p}>{PRIORIDAD_SOPORTE_META[p].label}</option>)}
          </select>
        </div>
      )}
      {(destino || asignado || prioridad) && (
        <>
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3}
            placeholder={!accion?.comentario ? 'Comentario (opcional)…' : agente ? 'Comentario obligatorio: qué se hizo / qué cambió / por qué…' : destino === 'ABIERTO' ? 'Cuéntanos qué sigue fallando…' : 'Escribe un comentario (obligatorio)…'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
          {(accion?.evidencia ?? true) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">Evidencia:</span>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                <Camera className="w-4 h-4" /> Foto / video
                <input type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                <Paperclip className="w-4 h-4" /> Archivos
                <input type="file" multiple accept="image/*,video/*,application/pdf,.txt,.log,.json,.csv,.xlsx" className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
              </label>
              {archivos.map((f, i) => (
                <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                  <span className="max-w-[140px] truncate">{f.name}</span>
                  <button onClick={() => setArchivos((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Quitar">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {paso && <span className="flex items-center gap-1 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> {paso}</span>}
            <button onClick={aplicar} disabled={enviando}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
              {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
              {accion ? accion.label : 'Guardar cambios'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
