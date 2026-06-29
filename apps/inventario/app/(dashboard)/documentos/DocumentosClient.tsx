'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Upload, FileText, Image, Trash2, Loader2,
  CheckCircle2, AlertCircle, ExternalLink, RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Tab = 'sst' | 'galeria'

interface Archivo {
  name: string
  id: string
  metadata?: { size: number; mimetype: string }
}

interface Props {
  sstInicial: Archivo[]
  galeriaInicial: Archivo[]
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

function publicUrl(bucket: string, name: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${name}`
}

function formatSize(bytes?: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentosClient({ sstInicial, galeriaInicial }: Props) {
  const [tab, setTab]             = useState<Tab>('sst')
  const [sstFiles, setSst]        = useState<Archivo[]>(sstInicial)
  const [galeriaFiles, setGal]    = useState<Archivo[]>(galeriaInicial)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [msg, setMsg]             = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [dragging, setDragging]   = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const inputRef                  = useRef<HTMLInputElement>(null)
  const supabase                  = createClient()

  const bucket  = tab === 'sst' ? 'documentos-sst' : 'galeria-fotos'
  const archivos = tab === 'sst' ? sstFiles : galeriaFiles
  const setArchivos = tab === 'sst' ? setSst : setGal

  const aceptados = tab === 'sst'
    ? 'application/pdf,image/jpeg,image/png'
    : 'image/jpeg,image/png,image/webp'

  const refresh = useCallback(async () => {
    const { data } = await supabase.storage.from(bucket).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
    if (data) setArchivos(data as Archivo[])
  }, [bucket, supabase, setArchivos])

  const upload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setMsg(null)
    let ok = 0

    for (let i = 0; i < files.length; i++) {
      setProgress(Math.round((i / files.length) * 90))
      const file = files[i]
      const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path  = `${Date.now()}_${clean}`
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type })
      if (!error) ok++
    }

    setProgress(100)
    await refresh()
    setMsg({ tipo: 'ok', texto: `${ok} archivo(s) subido(s) correctamente.` })
    setUploading(false)
    setProgress(0)
    setTimeout(() => setMsg(null), 4000)
  }, [bucket, supabase, refresh])

  const eliminar = useCallback(async (name: string) => {
    setDeleting(name)
    await supabase.storage.from(bucket).remove([name])
    await refresh()
    setDeleting(null)
  }, [bucket, supabase, refresh])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    upload(e.dataTransfer.files)
  }

  return (
    <div className="space-y-6">

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { id: 'sst',     label: 'Documentos SST',   icon: FileText },
          { id: 'galeria', label: 'Galería de Fotos',  icon: Image },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-body text-sm font-semibold transition-all ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={() => setDragging(true)}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 ${
          dragging ? 'border-brand-green bg-green-50 scale-[1.01]' : 'border-gray-200 hover:border-brand-green/50 hover:bg-gray-50'
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="w-8 h-8 text-brand-green animate-spin" />
            <p className="font-body font-semibold text-sm text-gray-700">Subiendo... {progress}%</p>
            <div className="w-48 bg-gray-200 rounded-full h-1.5">
              <div className="bg-brand-green h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        ) : (
          <>
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
              <Upload className="w-6 h-6 text-gray-400" />
            </div>
            <div className="text-center">
              <p className="font-body font-semibold text-sm text-gray-700">
                Arrastra archivos o haz clic para seleccionar
              </p>
              <p className="font-body text-xs text-gray-400 mt-1">
                {tab === 'sst' ? 'PDF, JPG, PNG · máx. 20 MB' : 'JPG, PNG, WebP · máx. 10 MB'}
              </p>
            </div>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept={aceptados} multiple className="hidden"
        onChange={e => upload(e.target.files)} />

      {/* Message */}
      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${
          msg.tipo === 'ok'
            ? 'bg-green-50 border-green-100 text-green-700'
            : 'bg-red-50 border-red-100 text-red-700'
        }`}>
          {msg.tipo === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <p className="font-body text-sm">{msg.texto}</p>
        </div>
      )}

      {/* File list */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <p className="font-heading font-bold text-sm text-gray-900">
            {archivos.length} archivo(s) publicado(s)
          </p>
          <button onClick={refresh}
            className="flex items-center gap-1.5 font-body text-xs text-gray-500 hover:text-brand-green transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>

        {archivos.length === 0 ? (
          <div className="py-14 text-center text-gray-400">
            <p className="font-heading font-bold text-base">Sin archivos publicados</p>
            <p className="font-body text-sm mt-1">Sube tu primer archivo arriba</p>
          </div>
        ) : (
          <div className={tab === 'galeria' ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4' : ''}>
            {tab === 'sst' ? (
              <div className="divide-y divide-gray-50">
                {archivos.map(f => (
                  <div key={f.id ?? f.name} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/50">
                    <div className="w-9 h-9 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body font-medium text-sm text-gray-900 truncate">{f.name}</p>
                      <p className="font-body text-xs text-gray-400">{formatSize(f.metadata?.size)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a href={publicUrl(bucket, f.name)} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-brand-green transition-colors" title="Ver">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button onClick={() => eliminar(f.name)} disabled={deleting === f.name}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Eliminar">
                        {deleting === f.name
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              archivos.map(f => (
                <div key={f.id ?? f.name} className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={publicUrl(bucket, f.name)} alt={f.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <a href={publicUrl(bucket, f.name)} target="_blank" rel="noopener noreferrer"
                      className="p-2 bg-white rounded-lg text-gray-700 hover:text-brand-green transition-colors shadow">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button onClick={() => eliminar(f.name)} disabled={deleting === f.name}
                      className="p-2 bg-white rounded-lg text-red-500 hover:text-red-700 transition-colors shadow">
                      {deleting === f.name ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
