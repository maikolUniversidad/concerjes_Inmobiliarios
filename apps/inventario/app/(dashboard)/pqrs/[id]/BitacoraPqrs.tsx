'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Camera, Download, FileText, Flag, Loader2, MessageSquare, Paperclip, Send } from 'lucide-react'
import { toast } from 'sonner'
import { tamanoLegible } from '@/lib/mantenimiento'
import { useAdjuntosPegables } from '@/lib/adjuntos-chat'
import { ArchivosPendientes, VeloSoltar } from '@/components/ui/ArchivosPendientes'
import {
  ESTADO_PQRS_META, MAX_ADJUNTO_PQRS, SELECT_PQRS_BITACORA,
  horaCortaPqrs, legibleEstadosPqrs, subirArchivoPqrs,
  type EstadoPqrs, type Pqrs, type PqrsMensaje,
} from '@/lib/pqrs'

const hora = horaCortaPqrs

function Etiqueta({ estado, chica = false }: { estado: EstadoPqrs; chica?: boolean }) {
  const meta = ESTADO_PQRS_META[estado]
  if (!meta) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${chica ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'} ${meta.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
    </span>
  )
}

/**
 * Bitácora de la PQRS: mensajes de las personas y, como separadores, los
 * cambios de estado que escribe la BD (mensajes de SISTEMA). Es el expediente:
 * nada de aquí se puede editar ni borrar.
 */
export function BitacoraPqrs({ sb, pqrs, usuarioId, mensajes, urls, puedeEscribir, onNuevo }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  pqrs: Pqrs
  usuarioId: string
  mensajes: PqrsMensaje[]
  urls: Record<string, string>
  puedeEscribir: boolean
  onNuevo: (m: PqrsMensaje) => void
}) {
  const [texto, setTexto] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Cerrada o anulada: la bitácora queda como registro (igual que en la BD).
  const abierta = pqrs.estado !== 'CERRADA' && pqrs.estado !== 'ANULADA'
  const activo = puedeEscribir && abierta

  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes.length, urls])

  function agregar(lista: File[]) {
    const ok = lista.filter((f) => {
      if (f.size > MAX_ADJUNTO_PQRS) { toast.error(`"${f.name}" supera 50 MB.`); return false }
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
  const { arrastrando, zona } = useAdjuntosPegables(agregar, !activo)

  async function enviar() {
    const t = texto.trim()
    if (!t && archivos.length === 0) return
    setEnviando(true)
    try {
      if (archivos.length === 0) {
        const { data, error } = await sb.from('pqrs_bitacora')
          .insert({ pqrs_id: pqrs.id, tipo: 'MENSAJE', mensaje: t })
          .select(SELECT_PQRS_BITACORA).single()
        if (error) throw new Error(error.message)
        onNuevo(data)
      } else {
        for (let i = 0; i < archivos.length; i++) {
          const f = archivos[i]
          const a = await subirArchivoPqrs(sb, pqrs.id, f, f.name)
          const { data, error } = await sb.from('pqrs_bitacora').insert({
            pqrs_id: pqrs.id, tipo: 'ADJUNTO', mensaje: i === 0 && t ? t : null,
            adjunto_path: a.path, adjunto_nombre: a.nombre, adjunto_mime: a.mime, adjunto_bytes: a.bytes,
          }).select(SELECT_PQRS_BITACORA).single()
          if (error) throw new Error(error.message)
          onNuevo(data)
        }
      }
      setTexto(''); setArchivos([])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar.')
    } finally { setEnviando(false) }
  }

  return (
    <div {...zona} className="relative flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm lg:sticky lg:top-4 lg:h-[calc(100vh-9rem)]">
      <VeloSoltar visible={arrastrando} />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <MessageSquare className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading text-sm font-semibold text-gray-900">Bitácora</h2>
        <Etiqueta estado={pqrs.estado} />
        <span className="ml-auto flex items-center gap-1 font-body text-[11px] text-gray-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" /> en vivo
        </span>
      </div>

      <div ref={listaRef} className="flex-1 space-y-2 overflow-y-auto bg-gray-50/60 px-3 py-3">
        {mensajes.length === 0 && (
          <p className="py-6 text-center font-body text-sm text-gray-400">Todavía no hay movimientos.</p>
        )}
        {mensajes.map((m) => {
          if (m.tipo === 'SISTEMA') {
            const nuevo = m.estado_nuevo as EstadoPqrs | null
            const anterior = m.estado_anterior as EstadoPqrs | null
            const cambio = !!nuevo && !!anterior && nuevo !== anterior
            const [cabecera, ...resto] = (m.mensaje ?? '').split('\n')
            // Lo que va después de "Estado: X → Y" (responsable, prioridad, plazo).
            const extra = cambio ? cabecera.replace(/^Estado:\s*\S+\s*→\s*\S+\s*(·\s*)?/, '') : cabecera
            const comentario = resto.join('\n').trim()
            const esRespuesta = nuevo === 'RESPONDIDA' && cambio
            return (
              <div key={m.id} id={`msj-${m.id}`} className="flex flex-col items-center gap-1 py-1">
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
                <p className="text-center font-body text-[10px] text-gray-400">
                  {legibleEstadosPqrs(extra) && <span className="text-gray-600">{legibleEstadosPqrs(extra)} · </span>}
                  {m.usuario_nombre ?? 'Sistema'} · {hora(m.created_at)}
                </p>
                {comentario && (
                  <div className={`max-w-[92%] rounded-xl border px-3 py-2 font-body text-xs shadow-sm ${
                    esRespuesta ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-100 bg-white text-gray-700'}`}>
                    {esRespuesta && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">Respuesta registrada</p>}
                    <p className="whitespace-pre-wrap">{comentario}</p>
                  </div>
                )}
              </div>
            )
          }
          const mio = m.usuario_id === usuarioId
          const url = m.adjunto_path ? urls[m.adjunto_path] : undefined
          const esImagen = m.adjunto_mime?.startsWith('image/')
          const esVideo = m.adjunto_mime?.startsWith('video/')
          const esAudio = m.adjunto_mime?.startsWith('audio/')
          return (
            <div key={m.id} id={`msj-${m.id}`} className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
                mio ? 'rounded-br-sm bg-brand-green text-white' : 'rounded-bl-sm bg-white text-gray-800'}`}>
                {!mio && <p className="mb-0.5 font-body text-[11px] font-semibold text-brand-green">{m.usuario_nombre ?? 'Usuario'}</p>}
                {m.adjunto_path && (
                  esImagen ? (
                    url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={m.adjunto_nombre ?? 'Imagen'} className="max-h-60 rounded-lg bg-black/5 object-contain" />
                      </a>
                    ) : <div className="mb-1 h-32 w-48 animate-pulse rounded-lg bg-black/10" />
                  ) : esVideo && url ? (
                    <video src={url} controls playsInline className="mb-1 max-h-60 rounded-lg" />
                  ) : esAudio && url ? (
                    <audio src={url} controls className="mb-1 w-full" />
                  ) : (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 ${mio ? 'bg-white/15' : 'bg-gray-50'}`}>
                      <FileText className="w-5 h-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate font-body text-sm">{m.adjunto_nombre ?? 'Archivo'}</span>
                        <span className={`block font-body text-[10px] ${mio ? 'text-white/70' : 'text-gray-400'}`}>{tamanoLegible(m.adjunto_bytes)}</span>
                      </span>
                      <Download className="w-4 h-4 shrink-0 opacity-70" />
                    </a>
                  )
                )}
                {m.mensaje && <p className="whitespace-pre-wrap break-words font-body text-sm">{legibleEstadosPqrs(m.mensaje)}</p>}
                <p className={`mt-0.5 text-right font-body text-[10px] ${mio ? 'text-white/70' : 'text-gray-400'}`}>{hora(m.created_at)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {!activo ? (
        <p className="border-t border-gray-100 px-4 py-3 text-center font-body text-xs text-gray-400">
          {abierta ? 'Solo puedes leer la bitácora.' : 'La PQRS está cerrada: la bitácora queda como registro.'}
        </p>
      ) : (
        <div className="shrink-0 border-t border-gray-100 p-2">
          <ArchivosPendientes archivos={archivos} onQuitar={(i) => setArchivos((a) => a.filter((_, j) => j !== i))} />
          <div className="flex items-end gap-1.5">
            <button onClick={() => camRef.current?.click()} title="Foto o video" aria-label="Foto o video"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><Camera className="w-5 h-5" /></button>
            <button onClick={() => fileRef.current?.click()} title="Adjuntar archivo (o pega con Ctrl+V)" aria-label="Adjuntar archivo"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><Paperclip className="w-5 h-5" /></button>
            <textarea ref={taRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
              placeholder="Escribe un seguimiento… (Ctrl+V pega capturas)"
              className="max-h-32 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
            <button onClick={enviar} disabled={enviando || (!texto.trim() && archivos.length === 0)}
              aria-label="Enviar" title="Enviar"
              className="rounded-xl bg-brand-green p-2.5 text-white hover:bg-brand-green-dark disabled:opacity-40">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <input ref={fileRef} type="file" multiple className="hidden"
            onChange={(e) => { agregar(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <input ref={camRef} type="file" accept="image/*,video/*" capture="environment" className="hidden"
            onChange={(e) => { agregar(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>
      )}
    </div>
  )
}
