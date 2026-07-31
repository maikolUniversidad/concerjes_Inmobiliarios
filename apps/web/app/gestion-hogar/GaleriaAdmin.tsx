'use client'

import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Loader2, Upload, Trash2, Eye, EyeOff, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { getGestionSupabase } from '@/lib/supabase/gestion'

const BUCKET = 'servicios-hogar'

interface Foto {
  id: string; titulo: string | null; url: string; storage_path: string | null
  activo: boolean; tipo_id: string | null; media_tipo: string; poster_url: string | null
  tipos_servicio_hogar: { nombre: string } | null
}
interface Tipo { id: string; nombre: string }

export function GaleriaAdmin({ session }: { session: Session }) {
  const [fotos, setFotos] = useState<Foto[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [tipoId, setTipoId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function cargar() {
    const sb = getGestionSupabase()
    const [{ data: fs }, { data: ts }] = await Promise.all([
      sb.from('galeria_servicio_hogar').select('id, titulo, url, storage_path, activo, tipo_id, media_tipo, poster_url, tipos_servicio_hogar(nombre)').order('orden').order('created_at', { ascending: false }),
      sb.from('tipos_servicio_hogar').select('id, nombre').eq('activo', true).order('orden'),
    ])
    setFotos((fs as unknown as Foto[]) ?? [])
    setTipos((ts as Tipo[]) ?? [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  async function onArchivos(files: FileList | null) {
    if (!files || files.length === 0) return
    setSubiendo(true)
    const sb = getGestionSupabase()
    let ok = 0
    for (const file of Array.from(files)) {
      const esVideo = file.type.startsWith('video/')
      const esImagen = file.type.startsWith('image/')
      if (!esVideo && !esImagen) { toast.error(`"${file.name}" no es imagen ni video.`); continue }
      const limite = esVideo ? 50 : 8
      if (file.size > limite * 1024 * 1024) { toast.error(`"${file.name}" supera ${limite} MB.`); continue }
      const ext = file.name.split('.').pop()?.toLowerCase() || (esVideo ? 'mp4' : 'jpg')
      const path = `galeria/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      if (upErr) { toast.error(`No se pudo subir "${file.name}".`); continue }
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
      const { error: insErr } = await sb.from('galeria_servicio_hogar').insert({
        titulo: titulo.trim() || null,
        tipo_id: tipoId || null,
        media_tipo: esVideo ? 'video' : 'imagen',
        storage_path: path,
        url: pub.publicUrl,
        created_by: session.user.id,
      })
      if (insErr) { await sb.storage.from(BUCKET).remove([path]); toast.error('No se pudo registrar el archivo.'); continue }
      ok++
    }
    setSubiendo(false)
    if (fileRef.current) fileRef.current.value = ''
    if (ok > 0) { toast.success(`${ok} archivo${ok === 1 ? '' : 's'} subido${ok === 1 ? '' : 's'}.`); setTitulo(''); cargar() }
  }

  async function toggle(f: Foto) {
    const sb = getGestionSupabase()
    await sb.from('galeria_servicio_hogar').update({ activo: !f.activo }).eq('id', f.id)
    cargar()
  }

  async function eliminar(f: Foto) {
    const sb = getGestionSupabase()
    if (f.storage_path) await sb.storage.from(BUCKET).remove([f.storage_path])
    const { error } = await sb.from('galeria_servicio_hogar').delete().eq('id', f.id)
    if (error) { toast.error('No se pudo eliminar.'); return }
    toast.success('Imagen eliminada.')
    cargar()
  }

  return (
    <div className="space-y-6">
      {/* Subida */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-heading font-bold text-gray-900">Subir imágenes y videos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (opcional, p.ej. Antes / Después)"
            className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
          <select value={tipoId} onChange={(e) => setTipoId(e.target.value)}
            className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green">
            <option value="">Servicio (opcional)</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={(e) => onArchivos(e.target.files)} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Seleccionar archivos
        </button>
        <p className="mt-2 text-xs text-gray-400">Imágenes (JPG/PNG/WebP, 8 MB) o videos (MP4/WebM, 50 MB). Puedes seleccionar varios a la vez.</p>
      </div>

      {/* Listado */}
      {cargando ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>
      ) : fotos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-400">
          <ImageIcon className="mx-auto h-8 w-8" />
          <p className="mt-2 text-sm">Aún no hay imágenes en la galería.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {fotos.map((f) => (
            <div key={f.id} className={`group relative overflow-hidden rounded-xl border bg-white ${f.activo ? 'border-gray-200' : 'border-amber-300'}`}>
              <div className="relative aspect-square bg-gray-100">
                {f.media_tipo === 'video' ? (
                  <video src={f.url} poster={f.poster_url ?? undefined} className={`h-full w-full object-cover ${f.activo ? '' : 'opacity-50'}`} muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.titulo ?? ''} className={`h-full w-full object-cover ${f.activo ? '' : 'opacity-50'}`} />
                )}
                {f.media_tipo === 'video' && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">▶ Video</span>}
                {!f.activo && <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">Oculta</span>}
              </div>
              <div className="p-2">
                {f.titulo && <p className="truncate text-xs font-semibold text-gray-700">{f.titulo}</p>}
                {f.tipos_servicio_hogar?.nombre && <p className="truncate text-xs text-gray-400">{f.tipos_servicio_hogar.nombre}</p>}
                <div className="mt-1.5 flex gap-1">
                  <button onClick={() => toggle(f)} title={f.activo ? 'Ocultar' : 'Mostrar'} className="flex-1 rounded-lg bg-gray-100 py-1.5 text-gray-600 hover:bg-gray-200">
                    {f.activo ? <EyeOff className="mx-auto h-4 w-4" /> : <Eye className="mx-auto h-4 w-4" />}
                  </button>
                  <button onClick={() => eliminar(f)} title="Eliminar" className="flex-1 rounded-lg bg-red-50 py-1.5 text-red-600 hover:bg-red-100">
                    <Trash2 className="mx-auto h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
