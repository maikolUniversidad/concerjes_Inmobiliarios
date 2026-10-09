'use client'

import { useEffect, useRef, useState } from 'react'
import { Paperclip, Send, Loader2, FileText, Camera, MessageSquare, Download, ArrowRightLeft } from 'lucide-react'
import { toast } from 'sonner'
import {
  ESTADO_SOPORTE_META, MAX_ADJUNTO_SOPORTE, horaCortaSoporte, legibleEstados, SELECT_MENSAJE, subirArchivoSoporte,
  type EstadoSoporte, type SoporteMensaje,
} from '@/lib/soporte'
import { tamanoLegible } from '@/lib/mantenimiento'

const hora = horaCortaSoporte

/**
 * Chat y trazabilidad del ticket. Los cambios de estado llegan como mensajes
 * de SISTEMA (con su comentario) y la evidencia como adjuntos.
 */
export function ChatSoporte({ sb, ticketId, usuarioId, mensajes, urls, cerrado, onNuevo }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  ticketId: string
  usuarioId: string
  mensajes: SoporteMensaje[]
  urls: Record<string, string>
  cerrado: boolean
  onNuevo: (m: SoporteMensaje) => void
}) {
  const [texto, setTexto] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes.length, urls])

  function elegir(lista: FileList | null) {
    if (!lista) return
    const ok = Array.from(lista).filter((f) => {
      if (f.size > MAX_ADJUNTO_SOPORTE) { toast.error(`"${f.name}" supera 50 MB.`); return false }
      return true
    })
    setArchivos((prev) => [...prev, ...ok].slice(0, 6))
  }

  async function enviar() {
    const t = texto.trim()
    if (!t && archivos.length === 0) return
    setEnviando(true)
    try {
      if (archivos.length === 0) {
        const { data, error } = await sb.from('soporte_mensajes').insert({ ticket_id: ticketId, tipo: 'MENSAJE', mensaje: t }).select(SELECT_MENSAJE).single()
        if (error) throw new Error(error.message)
        onNuevo(data)
      } else {
        for (let i = 0; i < archivos.length; i++) {
          const f = archivos[i]
          const a = await subirArchivoSoporte(sb, ticketId, f, f.name)
          const { data, error } = await sb.from('soporte_mensajes').insert({
            ticket_id: ticketId, tipo: 'ADJUNTO', mensaje: i === 0 && t ? t : null,
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

  return (
    <div className="flex flex-col rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden h-[70vh] lg:h-[calc(100vh-9rem)] lg:sticky lg:top-4">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
        <MessageSquare className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-sm text-gray-900">Seguimiento</h2>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> en vivo
        </span>
      </div>

      <div ref={listaRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50/60">
        {mensajes.map((m) => {
          if (m.tipo === 'SISTEMA') {
            const nuevo = m.estado_nuevo as EstadoSoporte | null
            const [cabecera, ...resto] = (m.mensaje ?? '').split('\n')
            return (
              <div key={m.id} className="flex justify-center">
                <div className="max-w-[92%] rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-gray-400" />
                    {nuevo && ESTADO_SOPORTE_META[nuevo] && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ESTADO_SOPORTE_META[nuevo].cls}`}>{ESTADO_SOPORTE_META[nuevo].label}</span>
                    )}
                    <span className="font-semibold">{legibleEstados(cabecera)}</span>
                  </p>
                  {resto.length > 0 && <p className="mt-1 whitespace-pre-wrap text-gray-700">{resto.join('\n')}</p>}
                  <p className="mt-0.5 text-[10px] text-gray-400">{m.usuario_nombre ?? 'Sistema'} · {hora(m.created_at)}</p>
                </div>
              </div>
            )
          }
          const mio = m.usuario_id === usuarioId
          const url = m.adjunto_path ? urls[m.adjunto_path] : undefined
          const esImagen = m.adjunto_mime?.startsWith('image/')
          const esVideo = m.adjunto_mime?.startsWith('video/')
          return (
            <div key={m.id} className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
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
                {m.mensaje && <p className="text-sm whitespace-pre-wrap break-words">{m.mensaje}</p>}
                <p className={`mt-0.5 text-right text-[10px] ${mio ? 'text-white/70' : 'text-gray-400'}`}>{hora(m.created_at)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {cerrado ? (
        <p className="px-4 py-3 text-center text-xs text-gray-400 border-t border-gray-100">El ticket está cerrado: el chat queda como registro. Reábrelo si hace falta.</p>
      ) : (
        <div className="border-t border-gray-100 p-2 shrink-0">
          {archivos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {archivos.map((f, i) => (
                <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                  <Paperclip className="w-3 h-3" /> <span className="max-w-[140px] truncate">{f.name}</span>
                  <button onClick={() => setArchivos((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Quitar">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <button onClick={() => camRef.current?.click()} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" title="Foto o video" aria-label="Foto o video"><Camera className="w-5 h-5" /></button>
            <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" title="Adjuntar archivo" aria-label="Adjuntar archivo"><Paperclip className="w-5 h-5" /></button>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
              placeholder="Escribe un mensaje…"
              className="flex-1 max-h-32 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
            <button onClick={enviar} disabled={enviando || (!texto.trim() && archivos.length === 0)}
              className="p-2.5 rounded-xl bg-brand-green text-white hover:bg-brand-green-dark disabled:opacity-40" aria-label="Enviar">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
          <input ref={camRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
        </div>
      )}
    </div>
  )
}
