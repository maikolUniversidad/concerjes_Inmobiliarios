'use client'

import { useState, useMemo } from 'react'
import {
  Plus, Search, FolderPlus, Folder, FolderOpen, MessageSquare,
  MoreVertical, Pencil, Trash2, Pin, PinOff, FolderInput, ChevronDown,
} from 'lucide-react'
import type { IACarpeta, IAConversacion } from '@/lib/types/database'
import { cn } from '@/lib/utils'

interface Props {
  carpetas: IACarpeta[]
  conversaciones: IAConversacion[]
  activaId: string | null
  onSelect: (id: string) => void
  onNuevo: () => void
  onNuevaCarpeta: () => void
  onRenombrar: (conv: IAConversacion) => void
  onEliminar: (conv: IAConversacion) => void
  onMover: (conv: IAConversacion, carpetaId: string | null) => void
  onFijar: (conv: IAConversacion) => void
  onEliminarCarpeta: (carpeta: IACarpeta) => void
}

export function ChatSidebar(props: Props) {
  const { carpetas, conversaciones, activaId, onSelect, onNuevo, onNuevaCarpeta } = props
  const [q, setQ] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [moverId, setMoverId] = useState<string | null>(null)
  const [colapsadas, setColapsadas] = useState<Record<string, boolean>>({})

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = t ? conversaciones.filter(c => c.titulo.toLowerCase().includes(t)) : conversaciones
    return [...base].sort((a, b) => Number(b.fijada) - Number(a.fijada) || b.updated_at.localeCompare(a.updated_at))
  }, [conversaciones, q])

  const sinCarpeta = filtradas.filter(c => !c.carpeta_id)
  const porCarpeta = (cid: string) => filtradas.filter(c => c.carpeta_id === cid)

  const toggle = (id: string) => setColapsadas(s => ({ ...s, [id]: !s[id] }))

  function ConvRow({ conv }: { conv: IAConversacion }) {
    const active = conv.id === activaId
    return (
      <div className="relative group">
        <button
          onClick={() => onSelect(conv.id)}
          className={cn(
            'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
            active ? 'bg-brand-green/10 text-brand-green' : 'text-gray-600 hover:bg-gray-100'
          )}
        >
          {conv.fijada
            ? <Pin className="w-3.5 h-3.5 shrink-0 text-brand-green" />
            : <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />}
          <span className="flex-1 truncate text-sm font-body">{conv.titulo}</span>
        </button>

        {/* Botón menú */}
        <button
          onClick={() => { setMenuId(menuId === conv.id ? null : conv.id); setMoverId(null) }}
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700',
            menuId === conv.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          aria-label="Opciones"
        >
          <MoreVertical className="w-4 h-4" />
        </button>

        {/* Menú contextual */}
        {menuId === conv.id && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => { setMenuId(null); setMoverId(null) }} />
            <div className="absolute right-1 top-9 z-30 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
              <button onClick={() => { props.onRenombrar(conv); setMenuId(null) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <Pencil className="w-3.5 h-3.5" /> Renombrar
              </button>
              <button onClick={() => { props.onFijar(conv); setMenuId(null) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                {conv.fijada ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                {conv.fijada ? 'Desfijar' : 'Fijar'}
              </button>
              <button onClick={() => setMoverId(moverId === conv.id ? null : conv.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <FolderInput className="w-3.5 h-3.5" /> Mover a…
              </button>
              {moverId === conv.id && (
                <div className="border-y border-gray-100 bg-gray-50/60 max-h-44 overflow-y-auto">
                  {conv.carpeta_id && (
                    <button onClick={() => { props.onMover(conv, null); setMenuId(null); setMoverId(null) }}
                      className="flex w-full items-center gap-2 px-5 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
                      Sin carpeta
                    </button>
                  )}
                  {carpetas.filter(c => c.id !== conv.carpeta_id).map(c => (
                    <button key={c.id} onClick={() => { props.onMover(conv, c.id); setMenuId(null); setMoverId(null) }}
                      className="flex w-full items-center gap-2 px-5 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
                      <Folder className="w-3 h-3" /> {c.nombre}
                    </button>
                  ))}
                  {carpetas.length === 0 && (
                    <p className="px-5 py-1.5 text-xs text-gray-400">No hay carpetas</p>
                  )}
                </div>
              )}
              <button onClick={() => { props.onEliminar(conv); setMenuId(null) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Eliminar
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gray-50/80">
      {/* Acciones */}
      <div className="p-3 space-y-2 border-b border-gray-200">
        <button
          onClick={onNuevo}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 font-body font-semibold text-sm text-white hover:bg-brand-green-dark transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Nueva conversación
        </button>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar conversación…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Carpetas */}
        {carpetas.map(carpeta => {
          const items = porCarpeta(carpeta.id)
          const open = !colapsadas[carpeta.id]
          return (
            <div key={carpeta.id} className="group/folder">
              <div className="flex items-center gap-1 px-1">
                <button onClick={() => toggle(carpeta.id)}
                  className="flex flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-gray-100">
                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform', !open && '-rotate-90')} />
                  {open ? <FolderOpen className="w-4 h-4 text-amber-500" /> : <Folder className="w-4 h-4 text-amber-500" />}
                  <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-gray-500">{carpeta.nombre}</span>
                  <span className="text-xs text-gray-400">{items.length}</span>
                </button>
                <button onClick={() => props.onEliminarCarpeta(carpeta)}
                  className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/folder:opacity-100"
                  aria-label="Eliminar carpeta">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {open && (
                <div className="ml-3 border-l border-gray-200 pl-1.5 space-y-0.5">
                  {items.length === 0
                    ? <p className="px-2 py-1 text-xs text-gray-300">Vacía</p>
                    : items.map(conv => <ConvRow key={conv.id} conv={conv} />)}
                </div>
              )}
            </div>
          )
        })}

        {/* Nueva carpeta */}
        <button
          onClick={onNuevaCarpeta}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <FolderPlus className="w-4 h-4" /> Nueva carpeta
        </button>

        {/* Sin carpeta */}
        {sinCarpeta.length > 0 && (
          <div className="pt-2">
            {carpetas.length > 0 && (
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sin carpeta</p>
            )}
            <div className="space-y-0.5">
              {sinCarpeta.map(conv => <ConvRow key={conv.id} conv={conv} />)}
            </div>
          </div>
        )}

        {filtradas.length === 0 && (
          <p className="px-2.5 py-6 text-center text-sm text-gray-400">
            {q ? 'Sin resultados' : 'Aún no hay conversaciones'}
          </p>
        )}
      </div>
    </div>
  )
}
