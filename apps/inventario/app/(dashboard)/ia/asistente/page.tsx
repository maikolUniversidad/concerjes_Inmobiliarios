'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, Bot, User, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const suggestions = [
  '¿Cuáles son los productos con stock crítico?',
  '¿Cuánto hipoclorito queda en bodega central?',
  '¿Qué productos vencen en los próximos 15 días?',
  'Genera orden de compra para stock crítico',
  '¿Cuáles son los 5 insumos más usados este mes?',
]

export default function AsistentePage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        '¡Hola! Soy el asistente de inventarios de Conserjes Inmobiliarios. Puedo ayudarte a consultar stock, analizar movimientos, generar órdenes de compra y más. ¿En qué te puedo ayudar?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string) {
    if (!text.trim()) return
    const userMsg: Message = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: text, historial: messages }),
      })
      const data = await res.json()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.respuesta || 'No pude procesar tu consulta.' },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error de conexión. Inténtalo nuevamente.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-green/10 rounded-xl flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-brand-green" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-xl text-gray-900">Asistente IA</h1>
            <p className="font-body text-xs text-gray-500">DeepSeek V3 · Inventarios Conserjes Inmobiliarios</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-body text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            En línea
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'assistant' ? 'bg-brand-green' : 'bg-gray-200'
              }`}
            >
              {msg.role === 'assistant' ? (
                <Bot className="w-4 h-4 text-white" />
              ) : (
                <User className="w-4 h-4 text-gray-600" />
              )}
            </div>
            <div
              className={`max-w-[75%] px-4 py-3 rounded-2xl font-body text-sm leading-relaxed ${
                msg.role === 'assistant'
                  ? 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm shadow-sm'
                  : 'bg-brand-green text-white rounded-tr-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <Loader2 className="w-4 h-4 text-brand-green animate-spin" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 sm:px-6 pb-2">
          <p className="font-body text-xs text-gray-400 mb-2">Sugerencias rápidas:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="font-body text-xs bg-gray-100 hover:bg-brand-green/10 hover:text-brand-green text-gray-600 px-3 py-1.5 rounded-full transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex gap-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu consulta de inventario..."
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-12 h-12 bg-brand-green text-white rounded-xl flex items-center justify-center hover:bg-brand-green-dark transition-colors disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  )
}
