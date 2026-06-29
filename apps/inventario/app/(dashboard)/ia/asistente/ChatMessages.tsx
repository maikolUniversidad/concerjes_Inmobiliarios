'use client'

import { useEffect, useRef } from 'react'
import { Bot, User, Sparkles, Mic, FileText, ImageIcon } from 'lucide-react'
import { Markdown } from './Markdown'
import { PREGUNTAS_SUGERIDAS } from '@/lib/ia/preguntas'

export interface ChatAttachmentView {
  name: string
  kind: 'image' | 'text'
  mime?: string
  dataUrl?: string
}

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  metadata?: Record<string, unknown> | null
  attachments?: ChatAttachmentView[]
}

interface Props {
  mensajes: ChatMessage[]
  streaming: boolean
  onPregunta: (texto: string) => void
}

function EmptyState({ onPregunta }: { onPregunta: (t: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/10">
          <Sparkles className="h-7 w-7 text-brand-green" />
        </div>
        <h2 className="font-heading text-xl font-bold text-gray-900">¿En qué te ayudo con el inventario?</h2>
        <p className="mt-1 font-body text-sm text-gray-500">
          Pregúntame en lenguaje natural. Puedo responder con tablas, resúmenes y gráficas.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {PREGUNTAS_SUGERIDAS.map(cat => (
          <div key={cat.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg border ${cat.color}`}>
                <cat.icon className="h-4 w-4" />
              </span>
              <h3 className="font-heading text-sm font-semibold text-gray-800">{cat.titulo}</h3>
            </div>
            <div className="space-y-1.5">
              {cat.preguntas.map(p => (
                <button
                  key={p}
                  onClick={() => onPregunta(p)}
                  className="block w-full rounded-lg px-2.5 py-2 text-left font-body text-sm text-gray-600 transition-colors hover:bg-brand-green/5 hover:text-brand-green"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChatMessages({ mensajes, streaming, onPregunta }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, streaming])

  if (mensajes.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <EmptyState onPregunta={onPregunta} />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-3 py-5 sm:px-4 space-y-5">
        {mensajes.map((m, i) => {
          const esAsistente = m.role === 'assistant'
          const esAudio = m.metadata?.audio === true
          return (
            <div key={m.id ?? i} className={`flex gap-3 ${esAsistente ? 'flex-row' : 'flex-row-reverse'}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${esAsistente ? 'bg-brand-green' : 'bg-gray-200'}`}>
                {esAsistente ? <Bot className="h-4 w-4 text-white" /> : <User className="h-4 w-4 text-gray-600" />}
              </div>
              <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 ${
                esAsistente
                  ? 'rounded-tl-sm border border-gray-100 bg-white shadow-sm'
                  : 'rounded-tr-sm bg-brand-green text-white'
              }`}>
                {esAudio && !esAsistente && (
                  <span className="mb-1 flex items-center gap-1 text-[11px] text-green-100">
                    <Mic className="h-3 w-3" /> Nota de voz
                  </span>
                )}
                {/* Adjuntos */}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {m.attachments.map((a, j) => a.kind === 'image' && a.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={a.dataUrl} alt={a.name}
                        className="h-24 w-24 rounded-lg border border-white/20 object-cover" />
                    ) : (
                      <span key={j} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${esAsistente ? 'bg-gray-100 text-gray-600' : 'bg-white/15 text-white'}`}>
                        {a.kind === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                        <span className="max-w-[160px] truncate">{a.name}</span>
                      </span>
                    ))}
                  </div>
                )}
                {esAsistente ? (
                  m.content
                    ? <Markdown>{m.content}</Markdown>
                    : <TypingDots />
                ) : (
                  <p className="whitespace-pre-wrap font-body text-sm leading-relaxed">{m.content}</p>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-brand-green [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-brand-green [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-brand-green" />
    </span>
  )
}
