'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Send, Loader2, FileText, Camera, MessageSquare, Download, ArrowRight, CheckCircle2, Flag, X, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import {
  ESTADO_SOPORTE_META, MAX_ADJUNTO_SOPORTE, accionesDisponibles, duracionLegible, fasesSoporte, horaCortaSoporte,
  legibleEstados, SELECT_MENSAJE, subirArchivoSoporte,
  type AdjuntoSubido, type EstadoSoporte, type SoporteMensaje, type SoporteTicket,
} from '@/lib/soporte'
import { tamanoLegible } from '@/lib/mantenimiento'
import { useAdjuntosPegables } from '@/lib/adjuntos-chat'
import { ArchivosPendientes, VeloSoltar } from '@/components/ui/ArchivosPendientes'

const hora = horaCortaSoporte

function Etiqueta({ estado, chica = false }: { estado: EstadoSoporte; chica?: boolean }) {
  const meta = ESTADO_SOPORTE_META[estado]
  if (!meta) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${chica ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'} ${meta.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
    </span>
  )
}

/**
 * Chat y trazabilidad del ticket. Los cambios de estado llegan como mensajes
 * de SISTEMA y se ven como etiquetas (de → a, quién, cuánto duró la fase);
 * cada mensaje lleva la etiqueta del estado en que se escribió y la resolución
 * queda marcada. Desde aquí mismo se puede cambiar el estado: el texto va como
 * comentario y los archivos como evidencia.
 */
export function ChatSoporte({ sb, ticket, usuarioId, agente, mensajes, urls, onNuevo, onEstado }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  ticket: SoporteTicket
  usuarioId: string
  agente: boolean
  mensajes: SoporteMensaje[]
  urls: Record<string, string>
  onNuevo: (m: SoporteMensaje) => void
  onEstado: (t: SoporteTicket) => void
}) {
  const [texto, setTexto] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [destino, setDestino] = useState<EstadoSoporte | ''>('')
  const [menuEstado, setMenuEstado] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const cerrado = ticket.estado === 'CERRADO' || ticket.estado === 'CANCELADO'
  const acciones = accionesDisponibles(ticket.estado, agente, ticket.reportado_por === usuarioId)
  const accion = acciones.find((a) => a.estado === destino)
  const { fases, estadoDe, solucionVigenteId } = useMemo(() => fasesSoporte(mensajes, ticket.created_at), [mensajes, ticket.created_at])
  const duracion: Record<string, string> = {}
  fases.forEach((f, i) => {
    if (i > 0 && f.mensajeId) duracion[f.mensajeId] = duracionLegible(new Date(f.desde).getTime() - new Date(fases[i - 1].desde).getTime())
  })

  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes.length, urls])

  // Si el ticket cambia de estado (otra persona), la acción elegida puede ya no aplicar.
  useEffect(() => { setDestino(''); setMenuEstado(false) }, [ticket.estado])

  function agregar(lista: File[]) {
    const ok = lista.filter((f) => {
      if (f.size > MAX_ADJUNTO_SOPORTE) { toast.error(`"${f.name}" supera 50 MB.`); return false }
      return true
    })
    if (ok.length === 0) return
    setArchivos((prev) => {
      const todos = [...prev, ...ok]
      if (todos.length > 6) toast.message('Máximo 6 archivos por envío.')
      return todos.slice(0, 6)
    })
    taRef.current?.focus()
  }
  const puedeEscribir = !cerrado || acciones.length > 0
  const { arrastrando, zona } = useAdjuntosPegables(agregar, !puedeEscribir)

  async function enviar() {
    const t = texto.trim()
    if (accion) return cambiarEstado(t)
    if (cerrado) { toast.error('El ticket está cerrado: elige "Reabrir" para seguir.'); setMenuEstado(true); return }
    if (!t && archivos.length === 0) return
    setEnviando(true)
    try {
      if (archivos.length === 0) {
        const { data, error } = await sb.from('soporte_mensajes').insert({ ticket_id: ticket.id, tipo: 'MENSAJE', mensaje: t }).select(SELECT_MENSAJE).single()
        if (error) throw new Error(error.message)
        onNuevo(data)
      } else {
        for (let i = 0; i < archivos.length; i++) {
          const f = archivos[i]
          const a = await subirArchivoSoporte(sb, ticket.id, f, f.name)
          const { data, error } = await sb.from('soporte_mensajes').insert({
            ticket_id: ticket.id, tipo: 'ADJUNTO', mensaje: i === 0 && t ? t : null,
            adjunto_path: a.path, adjunto_nombre: a.nombre, adjunto_mime: a.mime, adjunto_bytes: a.bytes,
          }).select(SELECT_MENSAJE).single()
          if (error) throw new Error(error.message)
          onNuevo(data)
        }
      }
      setTexto(''); setArchivos([])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar.')
    } finally { setEnviando(false) }
  }

  async function cambiarEstado(comentario: string) {
    if (!accion) return
    if (accion.comentario && !comentario) {
      toast.error(destino === 'RESUELTO' ? 'Escribe la solución: qué se cambió o cómo se arregló.' : 'Escribe el comentario (obligatorio para este paso).')
      taRef.current?.focus()
      return
    }
    setEnviando(true)
    try {
      const adjuntos: AdjuntoSubido[] = []
      for (const f of archivos) adjuntos.push(await subirArchivoSoporte(sb, ticket.id, f, f.name))
      const { data, error } = await sb.rpc('soporte_cambiar_estado', {
        p_ticket: ticket.id, p_estado: destino, p_comentario: comentario || null,
        p_adjuntos: adjuntos, p_asignado: null, p_prioridad: null,
      })
      if (error) throw new Error(error.message)
      toast.success(`Estado: ${ESTADO_SOPORTE_META[destino as EstadoSoporte].label}`)
      setTexto(''); setArchivos([]); setDestino('')
      onEstado(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado.')
    } finally { setEnviando(false) }
  }

  function irASolucion() {
    if (!solucionVigenteId) return
    const el = document.getElementById(`msj-${solucionVigenteId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.classList.add('ring-2', 'ring-emerald-400')
    setTimeout(() => el?.classList.remove('ring-2', 'ring-emerald-400'), 1600)
  }

  const placeholder = cerrado && !accion ? 'Ticket cerrado: elige "Reabrir" para escribir…'
    : accion?.comentario ? (destino === 'RESUELTO' ? 'Escribe la solución (obligatorio)… Pega capturas con Ctrl+V' : 'Comentario obligatorio para este paso…')
    : accion ? 'Comentario (opcional)…'
    : 'Escribe un mensaje… (Ctrl+V pega capturas)'

  return (
    <div {...zona} className="relative flex flex-col rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden h-[70vh] lg:h-[calc(100vh-9rem)] lg:sticky lg:top-4">
      <VeloSoltar visible={arrastrando} />
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 shrink-0">
        <MessageSquare className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-sm text-gray-900">Seguimiento</h2>
        <Etiqueta estado={ticket.estado} />
        {solucionVigenteId && (
          <button onClick={irASolucion} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">
            <CheckCircle2 className="w-3 h-3" /> Ver solución
          </button>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> en vivo
        </span>
      </div>

      {/* Recorrido de estados */}
      {fases.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-100 px-3 py-1.5 shrink-0">
          {fases.map((f, i) => (
            <span key={`${f.estado}-${f.desde}`} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ArrowRight className="w-3 h-3 text-gray-300" />}
              <button onClick={() => f.mensajeId && document.getElementById(`msj-${f.mensajeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                title={`${ESTADO_SOPORTE_META[f.estado].label} desde ${hora(f.desde)}${f.por ? ` · ${f.por}` : ''}`}>
                <Etiqueta estado={f.estado} chica />
              </button>
            </span>
          ))}
        </div>
      )}

      <div ref={listaRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50/60">
        {mensajes.map((m) => {
          if (m.tipo === 'SISTEMA') {
            const nuevo = m.estado_nuevo as EstadoSoporte | null
            const anterior = m.estado_anterior as EstadoSoporte | null
            const cambio = !!nuevo && !!anterior && nuevo !== anterior
            const [cabecera, ...resto] = (m.mensaje ?? '').split('\n')
            // Lo que va después de "Estado: X → Y" (asignado, prioridad).
            const extra = cambio ? cabecera.replace(/^Estado:\s*\S+\s*→\s*\S+\s*(·\s*)?/, '') : cabecera
            const comentario = resto.join('\n').trim()
            const esSolucion = nuevo === 'RESUELTO' && cambio
            const vigente = m.id === solucionVigenteId
            return (
              <div key={m.id} id={`msj-${m.id}`} className="flex flex-col items-center gap-1 py-1 rounded-xl transition-shadow">
                <div className="flex w-full items-center gap-2">
                  <span className="h-px flex-1 bg-gray-200" />
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    {cambio ? (
                      <>
                        <Etiqueta estado={anterior!} chica />
                        <ArrowRight className="w-3 h-3 text-gray-400" />
                        <Etiqueta estado={nuevo!} />
                      </>
                    ) : nuevo ? <Etiqueta estado={nuevo} /> : <Flag className="w-3 h-3 text-gray-400" />}
                  </span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
                <p className="text-center text-[10px] text-gray-400">
                  {legibleEstados(extra) && <span className="text-gray-600">{legibleEstados(extra)} · </span>}
                  {m.usuario_nombre ?? 'Sistema'} · {hora(m.created_at)}
                  {cambio && duracion[m.id] && <> · tras {duracion[m.id]} en {ESTADO_SOPORTE_META[anterior!]?.label.toLowerCase()}</>}
                </p>
                {comentario && (
                  esSolucion ? (
                    <div className={`max-w-[92%] rounded-xl border px-3 py-2 text-xs shadow-sm ${vigente ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-white text-gray-600'}`}>
                      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {vigente ? 'Aquí se solucionó' : 'Solución anterior (se reabrió)'}
                      </p>
                      <p className="whitespace-pre-wrap">{comentario}</p>
                    </div>
                  ) : (
                    <p className="max-w-[92%] rounded-xl border border-gray-100 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm whitespace-pre-wrap">{comentario}</p>
                  )
                )}
              </div>
            )
          }
          const mio = m.usuario_id === usuarioId
          const url = m.adjunto_path ? urls[m.adjunto_path] : undefined
          const esImagen = m.adjunto_mime?.startsWith('image/')
          const esVideo = m.adjunto_mime?.startsWith('video/')
          const fase = estadoDe[m.id]
          return (
            <div key={m.id} id={`msj-${m.id}`} className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${mio ? 'bg-brand-green text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`}>
                {!mio && <p className="text-[11px] font-semibold text-brand-green mb-0.5">{m.usuario_nombre ?? 'Usuario'}</p>}
                {m.adjunto_path && (
                  esImagen ? (
                    url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={m.adjunto_nombre ?? 'Imagen'} className="max-h-60 rounded-lg object-contain bg-black/5" />
                      </a>
                    ) : <div className="h-32 w-48 mb-1 rounded-lg bg-black/10 animate-pulse" />
                  ) : esVideo && url ? (
                    <video src={url} controls playsInline className="max-h-60 rounded-lg mb-1" />
                  ) : (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 ${mio ? 'bg-white/15' : 'bg-gray-50'}`}>
                      <FileText className="w-5 h-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{m.adjunto_nombre ?? 'Archivo'}</span>
                        <span className={`block text-[10px] ${mio ? 'text-white/70' : 'text-gray-400'}`}>{tamanoLegible(m.adjunto_bytes)}</span>
                      </span>
                      <Download className="w-4 h-4 shrink-0 opacity-70" />
                    </a>
                  )
                )}
                {m.mensaje && <p className="text-sm whitespace-pre-wrap break-words">{legibleEstados(m.mensaje)}</p>}
                <p className={`mt-0.5 flex items-center justify-end gap-1.5 text-[10px] ${mio ? 'text-white/70' : 'text-gray-400'}`}>
                  {fase && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 ${mio ? 'bg-white/15 text-white' : ESTADO_SOPORTE_META[fase].cls}`}
                      title="Estado del ticket cuando se escribió">
                      <span className={`h-1.5 w-1.5 rounded-full ${ESTADO_SOPORTE_META[fase].dot}`} />{ESTADO_SOPORTE_META[fase].label}
                    </span>
                  )}
                  {hora(m.created_at)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {!puedeEscribir ? (
        <p className="px-4 py-3 text-center text-xs text-gray-400 border-t border-gray-100">El ticket está cerrado: el chat queda como registro.</p>
      ) : (
        <div className="relative border-t border-gray-100 p-2 shrink-0">
          {/* Menú de estados */}
          {menuEstado && acciones.length > 0 && (
            <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg z-10">
              <p className="mb-1.5 px-1 text-[11px] font-semibold text-gray-500">Cambiar estado al enviar (tu mensaje va como comentario y los archivos como evidencia)</p>
              <div className="flex flex-wrap gap-1.5">
                {acciones.map((a) => (
                  <button key={a.estado} onClick={() => { setDestino(a.estado); setMenuEstado(false); taRef.current?.focus() }}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:opacity-80 ${ESTADO_SOPORTE_META[a.estado].cls.replace('line-through', '')}`}>
                    {a.label}{a.comentario ? ' *' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {accion && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
              Al enviar: <Etiqueta estado={ticket.estado} chica /> <ArrowRight className="w-3 h-3" /> <Etiqueta estado={accion.estado} chica />
              <span className="truncate">{accion.label}{accion.comentario ? ' · comentario obligatorio' : ''}</span>
              <button onClick={() => setDestino('')} className="ml-auto text-gray-400 hover:text-red-500" aria-label="Quitar cambio de estado"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          <ArchivosPendientes archivos={archivos} onQuitar={(i) => setArchivos((a) => a.filter((_, j) => j !== i))} />

          <div className="flex items-end gap-1.5">
            {acciones.length > 0 && (
              <button onClick={() => setMenuEstado((v) => !v)} title="Cambiar estado" aria-label="Cambiar estado"
                className={`flex items-center gap-0.5 rounded-lg px-2 py-2 text-xs font-semibold ${menuEstado || accion ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Flag className="w-4 h-4" /><ChevronUp className={`w-3 h-3 transition-transform ${menuEstado ? '' : 'rotate-180'}`} />
              </button>
            )}
            <button onClick={() => camRef.current?.click()} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" title="Foto o video" aria-label="Foto o video"><Camera className="w-5 h-5" /></button>
            <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" title="Adjuntar archivo (o pega con Ctrl+V)" aria-label="Adjuntar archivo"><Paperclip className="w-5 h-5" /></button>
            <textarea ref={taRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
              placeholder={placeholder}
              className="flex-1 max-h-32 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
            <button onClick={enviar} disabled={enviando || (!accion && !texto.trim() && archivos.length === 0)}
              className={`p-2.5 rounded-xl text-white disabled:opacity-40 ${accion ? 'bg-gray-900 hover:bg-gray-700' : 'bg-brand-green hover:bg-brand-green-dark'}`}
              aria-label={accion ? accion.label : 'Enviar'} title={accion ? accion.label : 'Enviar'}>
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { agregar(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <input ref={camRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { agregar(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>
      )}
    </div>
  )
}
