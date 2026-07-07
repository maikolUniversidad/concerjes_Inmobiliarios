'use client'

import { useMemo, useState } from 'react'
import {
  ChevronRight, ChevronDown, FolderTree, Folder, FileText, Plus,
  Pencil, Trash2, Loader2, CornerDownRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { cn } from '@/lib/utils'
import { construirArbol, type TipoDoc, type TipoNode } from './tipos'

interface Props {
  tipos: TipoDoc[]
  onChange: (tipos: TipoDoc[]) => void
}

export function TipoTree({ tipos, onChange }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const arbol = useMemo(() => construirArbol(tipos), [tipos])

  const toggle = (id: string) => setColapsados((s) => ({ ...s, [id]: !s[id] }))

  async function crear(parentId: string | null) {
    const nombre = window.prompt(parentId ? 'Nombre del nuevo subtipo:' : 'Nombre del nuevo tipo raíz:')?.trim()
    if (!nombre) return
    setBusy(parentId ?? 'root')
    try {
      const orden = tipos.filter((t) => t.parent_id === parentId).length
      const { data, error } = await sb.from('tipos_documentales')
        .insert({ parent_id: parentId, nombre, orden }).select('id, parent_id, nombre, descripcion, orden').single()
      if (error) throw error
      onChange([...tipos, data as TipoDoc])
      if (parentId) setColapsados((s) => ({ ...s, [parentId]: false }))
      await logActivity(sb, { accion: 'CREAR', modulo: 'Gestión Humana', descripcion: `Tipo documental creado: ${nombre}`, entidad: 'tipos_documentales', entidad_id: data.id })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear.')
    } finally { setBusy(null) }
  }

  async function renombrar(node: TipoNode) {
    const nombre = window.prompt('Nuevo nombre:', node.nombre)?.trim()
    if (!nombre || nombre === node.nombre) return
    try {
      await sb.from('tipos_documentales').update({ nombre }).eq('id', node.id)
      onChange(tipos.map((t) => (t.id === node.id ? { ...t, nombre } : t)))
    } catch { toast.error('No se pudo renombrar.') }
  }

  async function eliminar(node: TipoNode) {
    const nHijos = contarDescendientes(node)
    const msg = nHijos > 0
      ? `¿Eliminar "${node.nombre}" y sus ${nHijos} subtipo(s)? Los documentos asociados quedarán sin tipo.`
      : `¿Eliminar "${node.nombre}"? Los documentos asociados quedarán sin tipo.`
    if (!window.confirm(msg)) return
    try {
      // ON DELETE CASCADE elimina los descendientes en la BD.
      await sb.from('tipos_documentales').delete().eq('id', node.id)
      const idsEliminar = new Set<string>()
      const recolectar = (n: TipoNode) => { idsEliminar.add(n.id); n.hijos.forEach(recolectar) }
      recolectar(node)
      onChange(tipos.filter((t) => !idsEliminar.has(t.id)))
      await logActivity(sb, { accion: 'ELIMINAR', modulo: 'Gestión Humana', descripcion: `Tipo documental eliminado: ${node.nombre}`, entidad: 'tipos_documentales', entidad_id: node.id })
    } catch { toast.error('No se pudo eliminar.') }
  }

  function Nodo({ node }: { node: TipoNode }) {
    const tieneHijos = node.hijos.length > 0
    const abierto = !colapsados[node.id]
    return (
      <div>
        <div
          className="group flex items-center gap-1.5 rounded-lg px-2 py-2 hover:bg-gray-50"
          style={{ paddingLeft: `${node.profundidad * 1.1 + 0.5}rem` }}
        >
          {tieneHijos ? (
            <button onClick={() => toggle(node.id)} className="p-0.5 text-gray-400 hover:text-gray-700">
              {abierto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <span className="w-5 inline-flex justify-center text-gray-300"><CornerDownRight className="w-3 h-3" /></span>
          )}
          {tieneHijos ? <Folder className="w-4 h-4 text-amber-500 shrink-0" /> : <FileText className="w-4 h-4 text-brand-green shrink-0" />}
          <span className="flex-1 font-body text-sm text-gray-800 truncate">{node.nombre}</span>

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button onClick={() => crear(node.id)} title="Añadir subtipo"
              className="p-1.5 rounded-md text-gray-400 hover:text-brand-green hover:bg-green-50">
              {busy === node.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => renombrar(node)} title="Renombrar" className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => eliminar(node)} title="Eliminar" className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {tieneHijos && abierto && node.hijos.map((h) => <Nodo key={h.id} node={h} />)}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderTree className="w-4 h-4 text-brand-green" />
          <h3 className="font-heading font-semibold text-sm text-gray-900">Árbol de tipos documentales</h3>
        </div>
        <button onClick={() => crear(null)} disabled={busy === 'root'}
          className={cn('flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 font-body font-semibold text-xs text-white hover:bg-brand-green-dark transition-colors')}>
          {busy === 'root' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Tipo raíz
        </button>
      </div>

      <div className="p-2">
        {arbol.length === 0 ? (
          <div className="py-12 text-center">
            <FolderTree className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="font-body text-sm text-gray-400">Aún no hay tipos documentales.</p>
            <button onClick={() => crear(null)} className="mt-3 font-body text-sm text-brand-green hover:underline">Crear el primer tipo</button>
          </div>
        ) : (
          arbol.map((n) => <Nodo key={n.id} node={n} />)
        )}
      </div>
      <p className="px-4 pb-3 font-body text-[11px] text-gray-400">
        Pasa el mouse (o toca) un nodo para añadir subtipos, renombrar o eliminar. Puedes anidar ramas ilimitadamente.
      </p>
    </div>
  )
}

function contarDescendientes(node: TipoNode): number {
  return node.hijos.reduce((acc, h) => acc + 1 + contarDescendientes(h), 0)
}
