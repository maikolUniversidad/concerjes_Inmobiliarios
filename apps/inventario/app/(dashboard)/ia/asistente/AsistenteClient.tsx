'use client'

import { useCallback, useRef, useState } from 'react'
import { Menu, Sparkles, ChevronDown, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { IACarpeta, IAConversacion } from '@/lib/types/database'
import { MODELOS, nombreModelo, type ModeloIA, type Attachment } from '@/lib/ia/types'
import { parseFile } from '@/lib/ia/parseFiles'
import { ChatSidebar } from './ChatSidebar'
import { ChatMessages, type ChatMessage } from './ChatMessages'
import { ChatComposer } from './ChatComposer'
import { cn } from '@/lib/utils'

interface Props {
  userId: string
  carpetasIniciales: IACarpeta[]
  conversacionesIniciales: IAConversacion[]
}

function nuevoId() {
  return (globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`)
}

export function AsistenteClient({ userId, carpetasIniciales, conversacionesIniciales }: Props) {
  // El cliente tipado de este proyecto devuelve `never` en escrituras (mismo
  // patrón que el resto de actions del repo): se usa un alias laxo para CRUD.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())

  const [carpetas, setCarpetas] = useState<IACarpeta[]>(carpetasIniciales)
  const [conversaciones, setConversaciones] = useState<IAConversacion[]>(conversacionesIniciales)
  const [activaId, setActivaId] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [modelo, setModelo] = useState<ModeloIA>('deepseek-chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modeloOpen, setModeloOpen] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [parsing, setParsing] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const convActiva = conversaciones.find(c => c.id === activaId) ?? null

  // ── Persistencia (tolerante a fallos: el chat sigue funcionando en memoria) ──
  const persistInsertConv = useCallback(async (conv: IAConversacion) => {
    try {
      const { error } = await sb.from('ia_conversaciones').insert({
        id: conv.id, user_id: userId, titulo: conv.titulo, modelo: conv.modelo,
        carpeta_id: conv.carpeta_id, fijada: conv.fijada,
      })
      if (error) throw error
    } catch { /* persistencia opcional */ }
  }, [sb, userId])

  const persistMensaje = useCallback(async (convId: string, m: ChatMessage) => {
    try {
      await sb.from('ia_mensajes').insert({
        conversacion_id: convId, user_id: userId, role: m.role,
        content: m.content, metadata: m.metadata ?? {},
      })
    } catch { /* noop */ }
  }, [sb, userId])

  // ── Archivos adjuntos ───────────────────────────────────────────────────────
  const onAddFiles = useCallback(async (files: File[]) => {
    setParsing(true)
    for (const file of files) {
      try {
        const att = await parseFile(file)
        setAttachments(prev => [...prev, att])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `No se pudo leer "${file.name}".`)
      }
    }
    setParsing(false)
  }, [])

  const onRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

  // ── Acciones de conversación ────────────────────────────────────────────────
  const nuevaConversacion = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
    setActivaId(null)
    setMensajes([])
    setInput('')
    setAttachments([])
    setSidebarOpen(false)
  }, [])

  const seleccionar = useCallback(async (id: string) => {
    abortRef.current?.abort()
    setStreaming(false)
    setActivaId(id)
    setSidebarOpen(false)
    setMensajes([])
    try {
      const { data } = await sb
        .from('ia_mensajes')
        .select('id, role, content, metadata')
        .eq('conversacion_id', id)
        .order('created_at', { ascending: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMensajes((data ?? []).map((d: any) => ({
        id: d.id, role: d.role === 'assistant' ? 'assistant' : 'user',
        content: d.content, metadata: d.metadata,
      })))
    } catch {
      toast.error('No se pudo cargar la conversación.')
    }
  }, [sb])

  // ── Envío de mensaje con streaming ──────────────────────────────────────────
  const enviar = useCallback(async (texto: string, fromAudio = false) => {
    const contenido = texto.trim()
    if (!contenido || streaming) return

    let convId = activaId
    // Crear conversación de forma diferida en el primer mensaje.
    if (!convId) {
      const titulo = contenido.length > 60 ? contenido.slice(0, 57) + '…' : contenido
      const nueva: IAConversacion = {
        id: nuevoId(), user_id: userId, carpeta_id: null, titulo, modelo,
        fijada: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      convId = nueva.id
      setConversaciones(prev => [nueva, ...prev])
      setActivaId(nueva.id)
      void persistInsertConv(nueva)
    }

    const userMsg: ChatMessage = { role: 'user', content: contenido, metadata: fromAudio ? { audio: true } : null }
    const historialParaApi = [...mensajes, userMsg].map(m => ({ role: m.role, content: m.content }))

    setMensajes(prev => [...prev, userMsg, { role: 'assistant', content: '', metadata: { modelo } }])
    setInput('')
    setStreaming(true)
    void persistMensaje(convId, userMsg)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/ia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: historialParaApi, modelo }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error('Error en la respuesta del asistente')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acumulado = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acumulado += decoder.decode(value, { stream: true })
        setMensajes(prev => {
          const copia = [...prev]
          copia[copia.length - 1] = { ...copia[copia.length - 1], content: acumulado }
          return copia
        })
      }

      const finalMsg: ChatMessage = { role: 'assistant', content: acumulado || 'No pude generar una respuesta.', metadata: { modelo } }
      setMensajes(prev => {
        const copia = [...prev]
        copia[copia.length - 1] = finalMsg
        return copia
      })
      void persistMensaje(convId, finalMsg)
      // Reordenar conversación al tope
      setConversaciones(prev => prev.map(c => c.id === convId ? { ...c, updated_at: new Date().toISOString() } : c))
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // Detenido por el usuario: conservar lo recibido
        setMensajes(prev => {
          const copia = [...prev]
          const last = copia[copia.length - 1]
          if (last && last.role === 'assistant' && !last.content) copia.pop()
          return copia
        })
      } else {
        setMensajes(prev => {
          const copia = [...prev]
          copia[copia.length - 1] = { role: 'assistant', content: '⚠️ Ocurrió un error procesando la consulta. Inténtalo nuevamente.', metadata: { error: true } }
          return copia
        })
        toast.error('Error al contactar al asistente.')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [activaId, mensajes, modelo, streaming, userId, persistInsertConv, persistMensaje])

  const detener = useCallback(() => abortRef.current?.abort(), [])

  // ── CRUD carpetas / conversaciones ──────────────────────────────────────────
  const crearCarpeta = useCallback(async () => {
    const nombre = window.prompt('Nombre de la nueva carpeta:')?.trim()
    if (!nombre) return
    const carpeta: IACarpeta = { id: nuevoId(), user_id: userId, nombre, color: 'green', orden: carpetas.length, created_at: new Date().toISOString() }
    setCarpetas(prev => [...prev, carpeta])
    try {
      await sb.from('ia_carpetas').insert({ id: carpeta.id, user_id: userId, nombre, color: 'green', orden: carpeta.orden })
    } catch { toast.error('No se pudo guardar la carpeta.') }
  }, [carpetas.length, sb, userId])

  const eliminarCarpeta = useCallback(async (carpeta: IACarpeta) => {
    if (!window.confirm(`¿Eliminar la carpeta "${carpeta.nombre}"? Las conversaciones se moverán a "Sin carpeta".`)) return
    setCarpetas(prev => prev.filter(c => c.id !== carpeta.id))
    setConversaciones(prev => prev.map(c => c.carpeta_id === carpeta.id ? { ...c, carpeta_id: null } : c))
    try { await sb.from('ia_carpetas').delete().eq('id', carpeta.id) } catch {}
  }, [sb])

  const renombrar = useCallback(async (conv: IAConversacion) => {
    const titulo = window.prompt('Nuevo nombre:', conv.titulo)?.trim()
    if (!titulo || titulo === conv.titulo) return
    setConversaciones(prev => prev.map(c => c.id === conv.id ? { ...c, titulo } : c))
    try { await sb.from('ia_conversaciones').update({ titulo }).eq('id', conv.id) } catch {}
  }, [sb])

  const eliminar = useCallback(async (conv: IAConversacion) => {
    if (!window.confirm(`¿Eliminar "${conv.titulo}"?`)) return
    setConversaciones(prev => prev.filter(c => c.id !== conv.id))
    if (activaId === conv.id) { setActivaId(null); setMensajes([]) }
    try { await sb.from('ia_conversaciones').delete().eq('id', conv.id) } catch {}
  }, [activaId, sb])

  const mover = useCallback(async (conv: IAConversacion, carpetaId: string | null) => {
    setConversaciones(prev => prev.map(c => c.id === conv.id ? { ...c, carpeta_id: carpetaId } : c))
    try { await sb.from('ia_conversaciones').update({ carpeta_id: carpetaId }).eq('id', conv.id) } catch {}
  }, [sb])

  const fijar = useCallback(async (conv: IAConversacion) => {
    const fijada = !conv.fijada
    setConversaciones(prev => prev.map(c => c.id === conv.id ? { ...c, fijada } : c))
    try { await sb.from('ia_conversaciones').update({ fijada }).eq('id', conv.id) } catch {}
  }, [sb])

  const sidebar = (
    <ChatSidebar
      carpetas={carpetas}
      conversaciones={conversaciones}
      activaId={activaId}
      onSelect={seleccionar}
      onNuevo={nuevaConversacion}
      onNuevaCarpeta={crearCarpeta}
      onRenombrar={renombrar}
      onEliminar={eliminar}
      onMover={mover}
      onFijar={fijar}
      onEliminarCarpeta={eliminarCarpeta}
    />
  )

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* Sidebar desktop */}
      <aside className="hidden lg:block w-72 shrink-0 border-r border-gray-200">{sidebar}</aside>

      {/* Sidebar móvil (drawer) */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-80 max-w-[85%] border-r border-gray-200 bg-white lg:hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <span className="font-heading font-semibold text-sm text-gray-700">Conversaciones</span>
              <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[calc(100%-3.25rem)]">{sidebar}</div>
          </aside>
        </>
      )}

      {/* Panel principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2.5 sm:px-4">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100" aria-label="Historial">
            <Menu className="h-5 w-5 text-gray-600" />
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green/10 shrink-0">
              <Sparkles className="h-4 w-4 text-brand-green" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-heading text-sm font-bold text-gray-900">
                {convActiva?.titulo ?? 'Asistente IA'}
              </h1>
              <p className="text-[11px] text-gray-400">Inventarios · Conserjes Inmobiliarios</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Selector de modelo */}
            <div className="relative">
              <button
                onClick={() => setModeloOpen(o => !o)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {nombreModelo(modelo)}
                <ChevronDown className="h-3 w-3" />
              </button>
              {modeloOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setModeloOpen(false)} />
                  <div className="absolute right-0 top-9 z-40 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                    {MODELOS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => { setModelo(m.id); setModeloOpen(false) }}
                        className={cn(
                          'flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-gray-50',
                          modelo === m.id && 'bg-brand-green/5'
                        )}
                      >
                        <span className="text-sm font-medium text-gray-800">{m.label}</span>
                        <span className="text-xs text-gray-400">{m.descripcion}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={nuevaConversacion}
              className="flex items-center gap-1.5 rounded-lg bg-brand-green px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-green-dark"
            >
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Nuevo</span>
            </button>
          </div>
        </header>

        {/* Mensajes */}
        <ChatMessages mensajes={mensajes} streaming={streaming} onPregunta={(t) => enviar(t)} />

        {/* Composer */}
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={() => enviar(input)}
          onStop={detener}
          streaming={streaming}
        />
      </div>
    </div>
  )
}
