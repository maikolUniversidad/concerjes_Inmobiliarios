'use client'

import { useEffect, useRef, useState } from 'react'
import {
  X, Brain, Loader2, Trash2, ImageIcon, Plus, Sparkles, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { imagenADataUrl } from './escaneo'

interface RefRow {
  id: string
  texto: string | null
  archivo_path: string | null
  origen: string
  created_at: string
}

interface Props {
  tipo: { id: string; label: string }
  onClose: () => void
  onChanged: () => void
}

export function MuestrasTipo({ tipo, onClose, onChanged }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const fileRef = useRef<HTMLInputElement>(null)
  const [refs, setRefs] = useState<RefRow[]>([])
  const [loading, setLoading] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [abriendo, setAbriendo] = useState<string | null>(null)

  async function cargar() {
    setLoading(true)
    const { data } = await sb.from('tipos_documentales_refs')
      .select('id, texto, archivo_path, origen, created_at')
      .eq('tipo_id', tipo.id)
      .order('created_at', { ascending: false })
    setRefs(data ?? [])
    setLoading(false)
  }
  useEffect(() => { cargar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tipo.id])

  async function agregar(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Sube una imagen del documento.'); return }
    setSubiendo(true)
    try {
      const dataUrl = await imagenADataUrl(file)
      // OCR / extracción de palabras clave
      let texto = ''
      try {
        const res = await fetch('/api/gestion-humana/analizar-doc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modo: 'ocr', imagen: dataUrl }),
        })
        const j = await res.json()
        texto = j.texto ?? ''
      } catch { /* si falla el OCR igual guardamos la muestra */ }

      // Subir imagen de la muestra al bucket
      const blob = await (await fetch(dataUrl)).blob()
      const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
      const path = `muestras/${tipo.id}/${id}.jpg`
      const { error: upErr } = await sb.storage.from('gestion-humana').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (upErr) throw upErr

      const { data: { user } } = await sb.auth.getUser()
      const { error: dbErr } = await sb.from('tipos_documentales_refs').insert({
        tipo_id: tipo.id, texto, archivo_path: path, origen: 'muestra', created_by: user?.id ?? null,
      })
      if (dbErr) throw dbErr

      toast.success('Muestra agregada. La clasificación mejorará con ella.')
      await cargar()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo agregar la muestra.')
    } finally {
      setSubiendo(false)
    }
  }

  async function abrir(r: RefRow) {
    if (!r.archivo_path) return
    setAbriendo(r.id)
    try {
      const { data } = await sb.storage.from('gestion-humana').createSignedUrl(r.archivo_path, 120)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } finally { setAbriendo(null) }
  }

  async function eliminar(r: RefRow) {
    if (!window.confirm('¿Eliminar esta muestra?')) return
    try {
      if (r.archivo_path) await sb.storage.from('gestion-humana').remove([r.archivo_path])
      await sb.from('tipos_documentales_refs').delete().eq('id', r.id)
      setRefs((prev) => prev.filter((x) => x.id !== r.id))
      onChanged()
    } catch { toast.error('No se pudo eliminar.') }
  }

  const muestras = refs.filter((r) => r.origen === 'muestra').length
  const aprendidos = refs.filter((r) => r.origen === 'confirmado').length

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-2xl bg-white shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:my-0 sm:h-full sm:rounded-none sm:rounded-l-2xl flex flex-col max-h-[85vh] sm:max-h-none">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Brain className="w-4 h-4 text-brand-green shrink-0" />
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-sm text-gray-900 truncate">Entrenamiento IA</h2>
              <p className="font-body text-xs text-gray-400 truncate">{tipo.label}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-xl bg-brand-green/5 border border-brand-green/10 p-3">
            <p className="flex items-center gap-1.5 font-body text-xs text-gray-600">
              <Sparkles className="w-3.5 h-3.5 text-brand-green" />
              Sube documentos de ejemplo de este tipo. La IA aprende sus palabras clave para clasificar automáticamente las cargas.
            </p>
            <p className="mt-2 font-body text-xs text-gray-500">
              <strong className="text-gray-700">{muestras}</strong> muestra(s) · <strong className="text-gray-700">{aprendidos}</strong> aprendida(s) de cargas confirmadas
            </p>
          </div>

          <button onClick={() => fileRef.current?.click()} disabled={subiendo}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-6 text-gray-500 hover:border-brand-green hover:bg-green-50/40 transition-colors disabled:opacity-60">
            {subiendo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            <span className="font-body text-sm">{subiendo ? 'Analizando…' : 'Agregar documento de referencia'}</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) agregar(f); e.target.value = '' }} />

          {loading ? (
            <div className="py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : refs.length === 0 ? (
            <p className="py-6 text-center font-body text-sm text-gray-400">Aún no hay muestras para este tipo.</p>
          ) : (
            <div className="space-y-2">
              {refs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border border-gray-100 p-2.5">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${r.origen === 'muestra' ? 'bg-brand-green/10 text-brand-green' : 'bg-blue-50 text-blue-500'}`}>
                    {r.origen === 'muestra' ? <ImageIcon className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-xs text-gray-700 line-clamp-2">{r.texto || '(sin texto extraído)'}</p>
                    <p className="font-body text-[10px] text-gray-400">{r.origen === 'muestra' ? 'Muestra' : 'Aprendido de carga'}</p>
                  </div>
                  {r.archivo_path && (
                    <button onClick={() => abrir(r)} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50">
                      {abriendo === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    </button>
                  )}
                  <button onClick={() => eliminar(r)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
