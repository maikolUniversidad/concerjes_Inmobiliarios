'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Search, User, FileText, Trash2, Loader2, FolderOpen, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { rutaTipo, type TipoDoc } from './tipos'
import type { PersonaLite } from './DocumentosClient'

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'

interface DocRow {
  id: string
  nombre_archivo: string
  archivo_path: string
  mime: string | null
  tamano: number | null
  tipo_documental_id: string | null
  created_at: string
}

interface Props {
  personas: PersonaLite[]
  tipos: TipoDoc[]
  initialPersonaId?: string
}

export function DocumentosPersona({ personas, tipos, initialPersonaId = '' }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [personaId, setPersonaId] = useState(initialPersonaId)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(false)
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const personaSel = personas.find((p) => p.id === personaId) ?? null
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = t ? personas.filter((p) => `${p.nombres} ${p.apellidos} ${p.documento}`.toLowerCase().includes(t)) : personas
    return base.slice(0, 30)
  }, [personas, q])

  useEffect(() => {
    if (!personaId) { setDocs([]); return }
    setLoading(true)
    sb.from('documentos_persona')
      .select('id, nombre_archivo, archivo_path, mime, tamano, tipo_documental_id, created_at')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: DocRow[] | null }) => { setDocs(data ?? []); setLoading(false) })
  }, [personaId, sb])

  async function abrir(doc: DocRow) {
    setAbriendo(doc.id)
    try {
      const { data, error } = await sb.storage.from('gestion-humana').createSignedUrl(doc.archivo_path, 120)
      if (error || !data?.signedUrl) throw error ?? new Error('No se pudo generar el enlace.')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      toast.error('No se pudo abrir el documento.')
    } finally { setAbriendo(null) }
  }

  async function eliminar(doc: DocRow) {
    if (!window.confirm(`¿Eliminar "${doc.nombre_archivo}"?`)) return
    try {
      await sb.storage.from('gestion-humana').remove([doc.archivo_path])
      await sb.from('documentos_persona').delete().eq('id', doc.id)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      await logActivity(sb, { accion: 'ELIMINAR', modulo: 'Gestión Humana', descripcion: `Documento eliminado: ${doc.nombre_archivo}`, entidad: 'documentos_persona', entidad_id: doc.id })
      toast.success('Documento eliminado.')
    } catch { toast.error('No se pudo eliminar.') }
  }

  // Agrupar por tipo documental
  const grupos = useMemo(() => {
    const m = new Map<string, DocRow[]>()
    for (const d of docs) {
      const key = d.tipo_documental_id ?? '__sin__'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(d)
    }
    return Array.from(m.entries())
  }, [docs])

  return (
    <div className="space-y-4">
      {/* Selector persona */}
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
          <span className={personaSel ? 'text-gray-800' : 'text-gray-400'}>
            {personaSel ? `${personaSel.nombres} ${personaSel.apellidos} · ${personaSel.documento}` : 'Selecciona una persona para ver sus documentos…'}
          </span>
          <User className="w-4 h-4 text-gray-400 shrink-0" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search className="w-4 h-4 text-gray-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="flex-1 bg-transparent text-sm outline-none" />
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {filtradas.map((p) => (
                  <button key={p.id} onClick={() => { setPersonaId(p.id); setOpen(false); setQ('') }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green/10 text-brand-green text-xs font-bold shrink-0">
                      {(p.nombres[0] ?? '') + (p.apellidos[0] ?? '')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-800 truncate">{p.nombres} {p.apellidos}</span>
                      <span className="block text-xs text-gray-400">{p.tipo_doc} {p.documento}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Documentos */}
      {personaId && (
        loading ? (
          <div className="py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : docs.length === 0 ? (
          <div className="py-12 text-center">
            <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="font-body text-sm text-gray-400">Esta persona aún no tiene documentos.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {grupos.map(([tipoId, lista]) => (
              <div key={tipoId} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                <p className="bg-gray-50 border-b border-gray-100 px-4 py-2 font-body font-semibold text-xs uppercase tracking-wide text-gray-500">
                  {tipoId === '__sin__' ? 'Sin clasificar' : rutaTipo(tipoId, tipos)}
                </p>
                <div className="divide-y divide-gray-50">
                  {lista.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                      <FileText className="w-4 h-4 text-brand-green shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-sm text-gray-800 truncate">{d.nombre_archivo}</p>
                        <p className="font-body text-xs text-gray-400">
                          {d.tamano ? `${(d.tamano / 1024).toFixed(0)} KB · ` : ''}
                          {new Date(d.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <button onClick={() => abrir(d)} title="Ver / descargar"
                        className="p-2 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50">
                        {abriendo === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                      </button>
                      <button onClick={() => eliminar(d)} title="Eliminar"
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
