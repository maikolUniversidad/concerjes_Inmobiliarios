'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  FileText, Trash2, Loader2, FolderOpen, ExternalLink, CheckCircle2, Circle,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { tiposParaSelect, type TipoDoc } from './tipos'
import { PersonaPicker } from './PersonaPicker'
import type { PersonaLite } from './DocumentosClient'

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
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(false)
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const opciones = useMemo(() => tiposParaSelect(tipos), [tipos])

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

  // Agrupar documentos por tipo + sin clasificar
  const { porTipo, sinClasificar } = useMemo(() => {
    const m = new Map<string, DocRow[]>()
    const sc: DocRow[] = []
    for (const d of docs) {
      if (!d.tipo_documental_id) { sc.push(d); continue }
      if (!m.has(d.tipo_documental_id)) m.set(d.tipo_documental_id, [])
      m.get(d.tipo_documental_id)!.push(d)
    }
    return { porTipo: m, sinClasificar: sc }
  }, [docs])

  const totalConDoc = opciones.filter((o) => porTipo.has(o.id)).length

  function DocItem({ d }: { d: DocRow }) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5">
        <FileText className="w-4 h-4 text-brand-green shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-body text-sm text-gray-800 truncate">{d.nombre_archivo}</p>
          <p className="font-body text-xs text-gray-400">
            {d.tamano ? `${(d.tamano / 1024).toFixed(0)} KB · ` : ''}
            {new Date(d.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button onClick={() => abrir(d)} title="Ver / descargar" className="p-2 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50">
          {abriendo === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
        </button>
        <button onClick={() => eliminar(d)} title="Eliminar" className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selector persona */}
      <PersonaPicker personas={personas} value={personaId} onChange={setPersonaId}
        placeholder="Selecciona una persona para ver su cumplimiento documental…" />

      {personaId && (
        loading ? (
          <div className="py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : opciones.length === 0 && docs.length === 0 ? (
          <div className="py-12 text-center">
            <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="font-body text-sm text-gray-400">No hay tipos documentales ni documentos.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Resumen de cumplimiento */}
            <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-2.5 shadow-sm">
              <p className="font-body text-sm text-gray-600">
                Cumplimiento: <span className="font-semibold text-brand-green">{totalConDoc}</span> de {opciones.length} tipos
              </p>
              <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-brand-green transition-all"
                  style={{ width: `${opciones.length ? (totalConDoc / opciones.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Checklist por tipo (semáforo) */}
            {opciones.map((o) => {
              const lista = porTipo.get(o.id) ?? []
              const tiene = lista.length > 0
              return (
                <div key={o.id} className={`rounded-2xl border shadow-sm overflow-hidden ${tiene ? 'border-green-200' : 'border-red-200'}`}>
                  <div className={`flex items-center gap-2 px-4 py-2.5 ${tiene ? 'bg-green-50/60' : 'bg-red-50/50'}`}>
                    {tiene ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" /> : <Circle className="w-4 h-4 text-red-400 shrink-0" />}
                    <span className="flex-1 font-body font-semibold text-sm text-gray-800 truncate">{o.label}</span>
                    <span className={`font-body text-xs font-medium ${tiene ? 'text-green-600' : 'text-red-500'}`}>
                      {tiene ? `${lista.length} archivo${lista.length === 1 ? '' : 's'}` : 'Pendiente'}
                    </span>
                  </div>
                  {tiene && (
                    <div className="divide-y divide-gray-50">
                      {lista.map((d) => <DocItem key={d.id} d={d} />)}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Documentos sin clasificar */}
            {sinClasificar.length > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <p className="bg-gray-50 border-b border-gray-100 px-4 py-2 font-body font-semibold text-xs uppercase tracking-wide text-gray-500">
                  Sin clasificar
                </p>
                <div className="divide-y divide-gray-50">
                  {sinClasificar.map((d) => <DocItem key={d.id} d={d} />)}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
