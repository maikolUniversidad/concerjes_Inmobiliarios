'use client'

/**
 * Galería de fotos para productos.
 *
 * modo='form'    → usado dentro de <form>. Sube fotos al instante y expone
 *                  las URLs via inputs ocultos (imagen_url + foto_extra[]).
 *                  La server action persiste las URLs en la BD.
 *
 * modo='directo' → usado en la vista de detalle / editar post-submit.
 *                  Guarda y elimina fotos directamente en Supabase (sin form).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import {
  Camera, Upload, X, Star, Loader2, AlertCircle, CheckCircle2, ImagePlus,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const MAX_MB   = 20
const MAX_SIZE = MAX_MB * 1024 * 1024
const BUCKET   = 'productos-fotos'

export interface FotoItem {
  id?: string          // solo en modo directo (row en producto_fotos)
  url: string
  storagePath?: string
  esPrincipal?: boolean
  orden?: number
}

// ── Modo formulario (create / edit sin ID previo) ─────────────────────────────
interface FormProps {
  modo: 'form'
  defaultFotos?: string[]     // URLs ya guardadas (editar)
  folder?: string
}

// ── Modo directo (detalle, guardado inmediato) ────────────────────────────────
interface DirectoProps {
  modo: 'directo'
  productoId: string
  initialFotos?: FotoItem[]   // cargadas por el server component
  onPrincipalChange?: (url: string) => void
}

type Props = FormProps | DirectoProps

// ── helpers ──────────────────────────────────────────────────────────────────

function ext(name: string) { return name.split('.').pop()?.toLowerCase() || 'jpg' }

function uid() { return globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()) }

// ── Subcomponente: miniatura ──────────────────────────────────────────────────

function Thumb({
  foto, isPrincipal, isUploading, progress, onDelete, onSetPrincipal,
}: {
  foto: FotoItem; isPrincipal: boolean; isUploading?: boolean; progress?: number
  onDelete: () => void; onSetPrincipal?: () => void
}) {
  return (
    <div className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all
      ${isPrincipal ? 'border-brand-green shadow-md shadow-brand-green/20' : 'border-gray-200'}`}>
      <Image src={foto.url} alt="Foto producto" fill className="object-cover" sizes="160px" />

      {/* Overlay acciones */}
      <div className="absolute inset-0 bg-black/0 hover:bg-black/50 transition-all flex flex-col items-center justify-center gap-1.5 group">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1.5 items-center">
          {onSetPrincipal && !isPrincipal && (
            <button type="button" onClick={onSetPrincipal}
              className="bg-yellow-400 text-white font-body text-xs px-2 py-1 rounded-lg flex items-center gap-1 shadow">
              <Star className="w-3 h-3" /> Principal
            </button>
          )}
          <button type="button" onClick={onDelete}
            className="bg-red-500 text-white font-body text-xs px-2 py-1 rounded-lg flex items-center gap-1 shadow">
            <X className="w-3 h-3" /> Quitar
          </button>
        </div>
      </div>

      {/* Badge principal */}
      {isPrincipal && (
        <div className="absolute top-1.5 left-1.5 bg-brand-green text-white text-xs font-body font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Star className="w-2.5 h-2.5" /> Principal
        </div>
      )}

      {/* Progreso */}
      {isUploading && (
        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
          <Loader2 className="w-5 h-5 text-white animate-spin" />
          <div className="w-3/4 bg-white/30 rounded-full h-1">
            <div className="bg-white h-1 rounded-full transition-all" style={{ width: `${progress ?? 0}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ProductoGaleria(props: Props) {
  const supabase = createClient()
  const fileRef    = useRef<HTMLInputElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)

  const [fotos,     setFotos]     = useState<FotoItem[]>([])
  const [uploading, setUploading] = useState<Set<string>>(new Set())
  const [progress,  setProgress]  = useState<Map<string, number>>(new Map())
  const [error,     setError]     = useState<string | null>(null)
  const [dragging,  setDragging]  = useState(false)

  // Cargar fotos iniciales
  useEffect(() => {
    if (props.modo === 'form') {
      const urls = props.defaultFotos ?? []
      setFotos(urls.map((url, i) => ({ url, esPrincipal: i === 0 })))
    } else {
      setFotos(props.initialFotos ?? [])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const principalIdx = fotos.findIndex(f => f.esPrincipal)
  const principalFoto = principalIdx >= 0 ? fotos[principalIdx] : fotos[0]

  // ── Upload ──────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File) => {
    setError(null)
    if (!file.type.startsWith('image/')) { setError('Solo se permiten imágenes (JPG, PNG, WebP)'); return }
    if (file.size > MAX_SIZE) { setError(`La imagen no puede superar ${MAX_MB} MB`); return }

    const tempId  = uid()
    const folder  = props.modo === 'form' ? (props.folder ?? 'nuevos') : (props as DirectoProps).productoId
    const path    = `${folder}/${tempId}.${ext(file.name)}`

    // Preview local inmediato
    const previewUrl = await new Promise<string>(res => {
      const r = new FileReader(); r.onload = e => res(e.target?.result as string); r.readAsDataURL(file)
    })
    const tempFoto: FotoItem = { id: tempId, url: previewUrl, storagePath: path, esPrincipal: fotos.length === 0 }
    setFotos(prev => [...prev, tempFoto])
    setUploading(prev => new Set(prev).add(tempId))
    setProgress(prev => new Map(prev).set(tempId, 0))

    try {
      const tick = setInterval(() => {
        setProgress(prev => new Map(prev).set(tempId, Math.min((prev.get(tempId) ?? 0) + 12, 85)))
      }, 150)

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type })
      clearInterval(tick)
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      if (props.modo === 'directo') {
        const pid = (props as DirectoProps).productoId
        const isFirst = fotos.length === 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: row } = await (supabase as any).from('producto_fotos').insert({
          producto_id: pid,
          url: publicUrl,
          storage_path: path,
          orden: fotos.length,
          es_principal: isFirst,
        }).select('id').single()

        if (isFirst) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from('productos').update({ imagen_url: publicUrl }).eq('id', pid)
          ;(props as DirectoProps).onPrincipalChange?.(publicUrl)
        }

        setFotos(prev => prev.map(f =>
          f.id === tempId ? { ...f, id: row?.id, url: publicUrl, storagePath: path } : f
        ))
      } else {
        setFotos(prev => prev.map(f =>
          f.id === tempId ? { ...f, url: publicUrl, storagePath: path } : f
        ))
      }

      setProgress(prev => new Map(prev).set(tempId, 100))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al subir la imagen')
      setFotos(prev => prev.filter(f => f.id !== tempId))
    } finally {
      setUploading(prev => { const s = new Set(prev); s.delete(tempId); return s })
    }
  }, [fotos.length, props, supabase])

  // ── Eliminar ─────────────────────────────────────────────────────────────────

  const deleteFoto = useCallback(async (foto: FotoItem) => {
    if (props.modo === 'directo') {
      if (foto.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('producto_fotos').delete().eq('id', foto.id)
      }
      if (foto.storagePath) {
        await supabase.storage.from(BUCKET).remove([foto.storagePath])
      }
      const wasPrincipal = foto.esPrincipal
      setFotos(prev => {
        const next = prev.filter(f => f.url !== foto.url)
        if (wasPrincipal && next.length > 0) {
          next[0].esPrincipal = true
          const pid = (props as DirectoProps).productoId
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(supabase as any).from('productos').update({ imagen_url: next[0].url }).eq('id', pid)
          ;(props as DirectoProps).onPrincipalChange?.(next[0].url)
        }
        return next
      })
    } else {
      setFotos(prev => {
        const next = prev.filter(f => f.url !== foto.url)
        if (foto.esPrincipal && next.length > 0) next[0].esPrincipal = true
        return next
      })
    }
  }, [props, supabase])

  // ── Set principal ──────────────────────────────────────────────────────────

  const setPrincipal = useCallback(async (foto: FotoItem) => {
    setFotos(prev => prev.map(f => ({ ...f, esPrincipal: f.url === foto.url })))

    if (props.modo === 'directo') {
      const pid = (props as DirectoProps).productoId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('productos').update({ imagen_url: foto.url }).eq('id', pid)
      ;(props as DirectoProps).onPrincipalChange?.(foto.url)
    }
  }, [props, supabase])

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    Array.from(e.dataTransfer.files).forEach(f => uploadFile(f))
  }, [uploadFile])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-body font-semibold text-sm text-gray-700">Fotos del producto</p>
        <span className="font-body text-xs text-gray-400">{fotos.length} foto{fotos.length !== 1 ? 's' : ''} · máx. {MAX_MB} MB c/u</span>
      </div>

      {/* Inputs ocultos para modo form */}
      {props.modo === 'form' && (
        <>
          <input type="hidden" name="imagen_url" value={principalFoto?.url ?? ''} />
          {fotos.filter(f => !f.esPrincipal).map((f, i) => (
            <input key={i} type="hidden" name="foto_extra" value={f.url} />
          ))}
        </>
      )}

      {/* Grid de fotos */}
      {fotos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {fotos.map((foto) => (
            <Thumb
              key={foto.url}
              foto={foto}
              isPrincipal={!!foto.esPrincipal || fotos.indexOf(foto) === 0 && !fotos.some(f => f.esPrincipal)}
              isUploading={foto.id ? uploading.has(foto.id) : false}
              progress={foto.id ? progress.get(foto.id) : undefined}
              onDelete={() => deleteFoto(foto)}
              onSetPrincipal={fotos.length > 1 ? () => setPrincipal(foto) : undefined}
            />
          ))}

          {/* Agregar más — celda inline */}
          <div
            onDragEnter={() => setDragging(true)}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-all
              ${dragging ? 'border-brand-green bg-green-50 scale-105' : 'border-gray-200 hover:border-brand-green hover:bg-green-50/30'}`}
          >
            <button type="button" onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-1 w-full h-full justify-center">
              <ImagePlus className="w-5 h-5 text-gray-400" />
              <span className="font-body text-xs text-gray-400">Agregar</span>
            </button>
          </div>
        </div>
      )}

      {/* Zona inicial (sin fotos) */}
      {fotos.length === 0 && (
        <div
          onDragEnter={() => setDragging(true)}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-2xl border-2 border-dashed transition-all p-8 flex flex-col items-center gap-4
            ${dragging ? 'border-brand-green bg-green-50 scale-[1.01]' : 'border-gray-200'}`}
        >
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <Camera className="w-7 h-7 text-gray-400" />
          </div>
          <div className="text-center">
            <p className="font-body font-semibold text-sm text-gray-700">Arrastra fotos aquí</p>
            <p className="font-body text-xs text-gray-400 mt-0.5">JPG, PNG, WebP · máx. {MAX_MB} MB por foto</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-4 py-2 font-body text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <Upload className="w-4 h-4" />
              Subir archivo
            </button>
            <button type="button" onClick={() => captureRef.current?.click()}
              className="flex items-center gap-1.5 bg-brand-green text-white rounded-xl px-4 py-2 font-body text-sm font-semibold hover:bg-brand-green-dark transition-colors">
              <Camera className="w-4 h-4" />
              Tomar foto
            </button>
          </div>
        </div>
      )}

      {/* Botones flotantes cuando ya hay fotos */}
      {fotos.length > 0 && (
        <div className="flex gap-2">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Subir archivo
          </button>
          <button type="button" onClick={() => captureRef.current?.click()}
            className="flex items-center gap-1.5 border border-brand-green text-brand-green rounded-xl px-3 py-2 font-body text-xs font-semibold hover:bg-green-50 transition-colors">
            <Camera className="w-3.5 h-3.5" />
            Tomar foto
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* File picker — archivo */}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
        multiple className="hidden"
        onChange={e => { Array.from(e.target.files ?? []).forEach(f => uploadFile(f)); e.target.value = '' }} />

      {/* Camera capture */}
      <input ref={captureRef} type="file" accept="image/*" capture="environment"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
    </div>
  )
}
