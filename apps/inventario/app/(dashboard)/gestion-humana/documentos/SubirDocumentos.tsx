'use client'

import { useMemo, useRef, useState } from 'react'
import {
  UploadCloud, Loader2, CheckCircle2, AlertCircle, FileText, X, Search, User,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { tiposParaSelect, type TipoDoc } from './tipos'
import type { PersonaLite } from './DocumentosClient'

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'

interface FileState {
  name: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

interface Props {
  personas: PersonaLite[]
  tipos: TipoDoc[]
}

function sanitize(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(-80)
}

export function SubirDocumentos({ personas, tipos }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [personaId, setPersonaId] = useState('')
  const [tipoId, setTipoId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [estados, setEstados] = useState<FileState[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [q, setQ] = useState('')
  const [openPicker, setOpenPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const opcionesTipo = useMemo(() => tiposParaSelect(tipos), [tipos])
  const personaSel = personas.find((p) => p.id === personaId) ?? null

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = t
      ? personas.filter((p) => `${p.nombres} ${p.apellidos} ${p.documento}`.toLowerCase().includes(t))
      : personas
    return base.slice(0, 30)
  }, [personas, q])

  function addFiles(list: FileList | null) {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }
  function quitar(i: number) {
    setFiles((prev) => prev.filter((_, j) => j !== i))
  }

  async function subir() {
    if (!personaId) { toast.error('Selecciona la persona.'); return }
    if (files.length === 0) { toast.error('Agrega al menos un archivo.'); return }
    setSubiendo(true)
    const nuevos: FileState[] = files.map((f) => ({ name: f.name, status: 'pending' }))
    setEstados(nuevos)

    const { data: { user } } = await sb.auth.getUser()
    let ok = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setEstados((prev) => prev.map((e, j) => (j === i ? { ...e, status: 'uploading' } : e)))
      try {
        const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
        const path = `${personaId}/${id}-${sanitize(file.name)}`
        const { error: upErr } = await sb.storage.from('gestion-humana').upload(path, file, {
          upsert: false, contentType: file.type || 'application/octet-stream',
        })
        if (upErr) throw upErr
        const { error: dbErr } = await sb.from('documentos_persona').insert({
          persona_id: personaId,
          tipo_documental_id: tipoId || null,
          nombre_archivo: file.name,
          archivo_path: path,
          mime: file.type || null,
          tamano: file.size,
          subido_por: user?.id ?? null,
        })
        if (dbErr) throw dbErr
        ok++
        setEstados((prev) => prev.map((e, j) => (j === i ? { ...e, status: 'done' } : e)))
      } catch (err) {
        setEstados((prev) => prev.map((e, j) => (j === i ? { ...e, status: 'error', error: err instanceof Error ? err.message : 'Error' } : e)))
      }
    }

    if (ok > 0) {
      await logActivity(sb, {
        accion: 'SUBIR', modulo: 'Gestión Humana',
        descripcion: `Subió ${ok} documento(s) a ${personaSel?.nombres} ${personaSel?.apellidos}`,
        entidad: 'documentos_persona', entidad_id: personaId,
      })
      toast.success(`${ok} documento(s) subido(s).`)
    }
    setFiles([])
    setSubiendo(false)
  }

  return (
    <div className="space-y-4">
      {/* Persona + tipo */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <div>
          <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Persona <span className="text-red-500">*</span></label>
          {/* Combobox de persona */}
          <div className="relative">
            <button type="button" onClick={() => setOpenPicker((o) => !o)}
              className={`${inputCls} flex items-center justify-between text-left`}>
              <span className={personaSel ? 'text-gray-800' : 'text-gray-400'}>
                {personaSel ? `${personaSel.nombres} ${personaSel.apellidos} · ${personaSel.documento}` : 'Selecciona una persona…'}
              </span>
              <User className="w-4 h-4 text-gray-400 shrink-0" />
            </button>
            {openPicker && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setOpenPicker(false)} />
                <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
                  <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o documento…"
                      className="flex-1 bg-transparent text-sm outline-none" />
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {filtradas.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">Sin resultados</p>}
                    {filtradas.map((p) => (
                      <button key={p.id} onClick={() => { setPersonaId(p.id); setOpenPicker(false); setQ('') }}
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
        </div>

        <div>
          <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Tipo documental</label>
          <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} className={inputCls}>
            <option value="">— Sin clasificar —</option>
            {opcionesTipo.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-200 bg-white py-10 flex flex-col items-center justify-center gap-2 hover:border-brand-green hover:bg-green-50/40 transition-colors"
      >
        <UploadCloud className="w-9 h-9 text-gray-300" />
        <p className="font-body text-sm text-gray-600">Haz clic o arrastra archivos aquí</p>
        <p className="font-body text-xs text-gray-400">Puedes subir varios a la vez (PDF, imágenes, Word…)</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      </div>

      {/* Cola de archivos */}
      {files.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-2">
          <p className="font-body font-semibold text-sm text-gray-700">{files.length} archivo(s) por subir</p>
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="flex-1 truncate font-body text-sm text-gray-700">{f.name}</span>
              <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
              {!subiendo && (
                <button onClick={() => quitar(i)} className="p-1 text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>
              )}
            </div>
          ))}
          <button onClick={subir} disabled={subiendo || !personaId}
            className="w-full mt-1 flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {subiendo ? 'Subiendo…' : `Subir ${files.length} documento(s)`}
          </button>
        </div>
      )}

      {/* Resultados */}
      {estados.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-1.5">
          {estados.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {e.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                : e.status === 'error' ? <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                : <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />}
              <span className="flex-1 truncate font-body text-gray-700">{e.name}</span>
              {e.status === 'error' && <span className="text-xs text-red-500">{e.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
