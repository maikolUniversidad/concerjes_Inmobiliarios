'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, Camera, Images, Loader2, Trash2, RefreshCw, Check, AlertCircle, ScanLine, Crop, Zap, Hand,
  RotateCcw, RotateCw, Sparkles, ArrowLeft, ArrowRight, Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import {
  capturarDeVideo, archivoAPagina, paginasAPdf, detectarDocumento, muestraGris, diferencia,
  rotarPagina, mejorarPagina, type Pagina,
} from './escaneo'

interface Props {
  personaId: string
  personaNombre: string
  tipo: { id: string; label: string }
  yaExiste: boolean
  onClose: () => void
  onSaved: (tipoId: string) => void
}

export function ScannerCaptura({ personaId, personaNombre, tipo, yaExiste, onClose, onSaved }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [paginas, setPaginas] = useState<Pagina[]>([])
  const [camError, setCamError] = useState<string | null>(null)
  const [camLista, setCamLista] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modo, setModo] = useState<'auto' | 'manual'>('auto')
  const [recortar, setRecortar] = useState(true)
  const [autoEstado, setAutoEstado] = useState<'buscando' | 'firme' | null>(null)

  // Refs para el bucle de autocaptura (evita closures obsoletos)
  const modoRef = useRef(modo)
  const recortarRef = useRef(recortar)
  const savingRef = useRef(saving)
  const editandoRef = useRef<number | null>(null)
  useEffect(() => { modoRef.current = modo }, [modo])
  useEffect(() => { recortarRef.current = recortar }, [recortar])
  useEffect(() => { savingRef.current = saving }, [saving])

  // Iniciar cámara al montar
  useEffect(() => {
    let cancelado = false
    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('Tu navegador no permite usar la cámara. Usa "Desde galería".')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
          setCamLista(true)
        }
      } catch {
        setCamError('No se pudo acceder a la cámara (permiso denegado o no disponible). Usa "Desde galería".')
      }
    }
    iniciar()
    return () => {
      cancelado = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const capturar = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const recorte = recortarRef.current ? detectarDocumento(v) : null
    setPaginas((prev) => [...prev, capturarDeVideo(v, { recorte })])
  }, [])

  // Bucle de autocaptura: cuando la cámara está quieta sobre un documento, dispara.
  useEffect(() => {
    if (!camLista) return
    const v = videoRef.current
    if (!v) return
    let prev: Uint8ClampedArray | null = null
    let estables = 0
    let armado = true
    const iv = setInterval(() => {
      if (modoRef.current !== 'auto' || savingRef.current || editandoRef.current != null) { setAutoEstado(null); return }
      const cur = muestraGris(v)
      const d = diferencia(prev, cur)
      prev = cur
      if (d > 7) { armado = true; estables = 0; setAutoEstado('buscando') }
      else { estables++; setAutoEstado(estables >= 3 ? 'firme' : 'buscando') }
      if (armado && estables >= 6) {
        if (!recortarRef.current || detectarDocumento(v)) {
          armado = false
          estables = 0
          capturar()
        }
      }
    }, 200)
    return () => clearInterval(iv)
  }, [camLista, capturar])

  async function agregarArchivos(list: FileList | null) {
    if (!list || list.length === 0) return
    const arr = Array.from(list)
    for (const f of arr) {
      if (!f.type.startsWith('image/')) continue
      try {
        const pg = await archivoAPagina(f)
        setPaginas((prev) => [...prev, pg])
      } catch { /* ignora imagen inválida */ }
    }
  }

  function quitar(id: string) {
    setPaginas((prev) => prev.filter((p) => p.id !== id))
    setEditando(null)
  }

  // ── Edición de páginas ──────────────────────────────────────────────────────
  const [editando, setEditando] = useState<number | null>(null)
  const [procesando, setProcesando] = useState(false)
  useEffect(() => { editandoRef.current = editando }, [editando])
  const pagEdit = editando != null ? paginas[editando] ?? null : null

  async function aplicar(fn: (pg: Pagina) => Promise<Pagina>) {
    if (editando == null || !paginas[editando]) return
    setProcesando(true)
    try {
      const nueva = await fn(paginas[editando])
      setPaginas((prev) => prev.map((p, i) => (i === editando ? nueva : p)))
    } catch {
      toast.error('No se pudo editar la página.')
    } finally {
      setProcesando(false)
    }
  }

  function mover(dir: -1 | 1) {
    if (editando == null) return
    const j = editando + dir
    if (j < 0 || j >= paginas.length) return
    setPaginas((prev) => {
      const cp = [...prev]
      ;[cp[editando], cp[j]] = [cp[j], cp[editando]]
      return cp
    })
    setEditando(j)
  }

  async function guardar() {
    if (paginas.length === 0) { toast.error('Captura al menos una página.'); return }
    if (yaExiste && !window.confirm(`Ya existe un documento de "${tipo.label}". ¿Reemplazarlo por el nuevo escaneo?`)) return

    setSaving(true)
    try {
      const blob = await paginasAPdf(paginas)
      const { data: { user } } = await sb.auth.getUser()
      const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
      const path = `${personaId}/${id}-escaneo.pdf`

      const { error: upErr } = await sb.storage.from('gestion-humana').upload(path, blob, {
        contentType: 'application/pdf', upsert: false,
      })
      if (upErr) throw upErr

      // Reemplazo: eliminar documentos previos de este tipo (storage + BD)
      if (yaExiste) {
        const { data: previos } = await sb
          .from('documentos_persona')
          .select('id, archivo_path')
          .eq('persona_id', personaId)
          .eq('tipo_documental_id', tipo.id)
        const paths = (previos ?? []).map((d: { archivo_path: string }) => d.archivo_path).filter(Boolean)
        if (paths.length) await sb.storage.from('gestion-humana').remove(paths)
        const ids = (previos ?? []).map((d: { id: string }) => d.id)
        if (ids.length) await sb.from('documentos_persona').delete().in('id', ids)
      }

      const { error: dbErr } = await sb.from('documentos_persona').insert({
        persona_id: personaId,
        tipo_documental_id: tipo.id,
        nombre_archivo: `${tipo.label.replace(/\s*\/\s*/g, ' - ')}.pdf`,
        archivo_path: path,
        mime: 'application/pdf',
        tamano: blob.size,
        subido_por: user?.id ?? null,
      })
      if (dbErr) throw dbErr

      await logActivity(sb, {
        accion: yaExiste ? 'REEMPLAZAR' : 'SUBIR', modulo: 'Gestión Humana',
        descripcion: `Escaneó "${tipo.label}" (${paginas.length} pág.) de ${personaNombre}`,
        entidad: 'documentos_persona', entidad_id: personaId,
      })
      toast.success(`Documento guardado (${paginas.length} página(s)).`)
      onSaved(tipo.id)
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.message || 'No se pudo guardar el escaneo.'
      console.error('Error guardando escaneo:', err)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-black/90 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-heading font-semibold text-sm truncate">
            <ScanLine className="w-4 h-4 text-brand-green shrink-0" /> {tipo.label}
          </p>
          <p className="text-[11px] text-white/60 truncate">{personaNombre} · {yaExiste ? 'Reemplazar existente' : 'Nuevo documento'}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-white/80 hover:bg-white/10"><X className="w-5 h-5" /></button>
      </div>

      {/* Cámara / preview */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden">
        {!camError ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="max-h-full max-w-full object-contain" />
            {!camLista && (
              <div className="absolute inset-0 flex items-center justify-center text-white/70">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            )}
            {/* Marco guía */}
            {camLista && (
              <div className={`pointer-events-none absolute inset-6 rounded-xl border-2 transition-colors ${
                modo === 'auto' && autoEstado === 'firme' ? 'border-brand-green' : 'border-white/30'
              }`} />
            )}

            {/* Controles superiores: modo + recorte */}
            {camLista && (
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                <div className="flex rounded-lg bg-black/50 p-0.5 backdrop-blur">
                  <button onClick={() => setModo('auto')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${modo === 'auto' ? 'bg-white text-gray-900' : 'text-white/80'}`}>
                    <Zap className="w-3.5 h-3.5" /> Auto
                  </button>
                  <button onClick={() => setModo('manual')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${modo === 'manual' ? 'bg-white text-gray-900' : 'text-white/80'}`}>
                    <Hand className="w-3.5 h-3.5" /> Manual
                  </button>
                </div>
                <button onClick={() => setRecortar((r) => !r)}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium backdrop-blur ${recortar ? 'bg-brand-green text-white' : 'bg-black/50 text-white/80'}`}>
                  <Crop className="w-3.5 h-3.5" /> {recortar ? 'Recorte ON' : 'Recorte OFF'}
                </button>
              </div>
            )}

            {/* Estado de autocaptura */}
            {camLista && modo === 'auto' && autoEstado && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur flex items-center gap-1.5">
                {autoEstado === 'firme'
                  ? <><ScanLine className="w-3.5 h-3.5 text-brand-green" /> Documento estable — capturando…</>
                  : <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enfoca el documento y mantén firme…</>}
              </div>
            )}
          </>
        ) : (
          <div className="max-w-sm px-6 text-center text-white/80">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-amber-400" />
            <p className="font-body text-sm">{camError}</p>
          </div>
        )}
      </div>

      {/* Miniaturas de páginas capturadas */}
      {paginas.length > 0 && (
        <div className="bg-black/90 px-3 py-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {paginas.map((p, i) => (
              <div key={p.id} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <button onClick={() => setEditando(i)} className="block" title="Editar página">
                  <img src={p.dataUrl} alt={`Página ${i + 1}`} className="h-20 w-16 rounded object-cover border border-white/20" />
                  <span className="absolute left-0.5 bottom-0.5 rounded bg-black/60 px-1 py-0.5 text-white"><Pencil className="w-2.5 h-2.5" /></span>
                </button>
                <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                <button onClick={() => quitar(p.id)} className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controles */}
      <div className="bg-black/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          {/* Galería / cámara del sistema */}
          <button onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-1 text-white/80 hover:text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"><Images className="w-5 h-5" /></span>
            <span className="text-[10px]">Galería</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={(e) => { agregarArchivos(e.target.files); e.target.value = '' }} />

          {/* Capturar */}
          <button onClick={capturar} disabled={!camLista || !!camError}
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-white text-brand-green disabled:opacity-40 active:scale-95 transition-transform"
            aria-label="Capturar página">
            <Camera className="w-7 h-7" />
          </button>

          {/* Guardar */}
          <button onClick={guardar} disabled={saving || paginas.length === 0}
            className="flex flex-col items-center gap-1 text-white disabled:opacity-40">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : yaExiste ? <RefreshCw className="w-5 h-5" /> : <Check className="w-5 h-5" />}
            </span>
            <span className="text-[10px]">{paginas.length > 0 ? `Guardar (${paginas.length})` : 'Guardar'}</span>
          </button>
        </div>
      </div>

      {/* ── Editor de página ── */}
      {pagEdit && (
        <div className="absolute inset-0 z-10 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="flex items-center gap-1.5 font-heading font-semibold text-sm">
              <Pencil className="w-4 h-4 text-brand-green" /> Editar página {editando! + 1} de {paginas.length}
            </span>
            <button onClick={() => setEditando(null)} className="p-2 rounded-lg text-white/80 hover:bg-white/10"><X className="w-5 h-5" /></button>
          </div>

          <div className="relative flex-1 min-h-0 flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pagEdit.dataUrl} alt="Página" className="max-h-full max-w-full object-contain rounded" />
            {procesando && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="w-8 h-8 animate-spin text-white" />
              </div>
            )}
          </div>

          {/* Reordenar */}
          <div className="flex items-center justify-center gap-3 pb-2 text-white">
            <button onClick={() => mover(-1)} disabled={editando === 0}
              className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs disabled:opacity-30">
              <ArrowLeft className="w-4 h-4" /> Mover
            </button>
            <button onClick={() => mover(1)} disabled={editando === paginas.length - 1}
              className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs disabled:opacity-30">
              Mover <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Acciones de edición */}
          <div className="grid grid-cols-4 gap-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-white">
            <button onClick={() => aplicar((p) => rotarPagina(p, 'izq'))} disabled={procesando}
              className="flex flex-col items-center gap-1 rounded-xl bg-white/10 py-2.5 hover:bg-white/15 disabled:opacity-40">
              <RotateCcw className="w-5 h-5" /><span className="text-[10px]">Girar izq.</span>
            </button>
            <button onClick={() => aplicar((p) => rotarPagina(p, 'der'))} disabled={procesando}
              className="flex flex-col items-center gap-1 rounded-xl bg-white/10 py-2.5 hover:bg-white/15 disabled:opacity-40">
              <RotateCw className="w-5 h-5" /><span className="text-[10px]">Girar der.</span>
            </button>
            <button onClick={() => aplicar((p) => mejorarPagina(p))} disabled={procesando}
              className="flex flex-col items-center gap-1 rounded-xl bg-white/10 py-2.5 hover:bg-white/15 disabled:opacity-40">
              <Sparkles className="w-5 h-5 text-brand-green" /><span className="text-[10px]">Mejorar</span>
            </button>
            <button onClick={() => quitar(pagEdit.id)}
              className="flex flex-col items-center gap-1 rounded-xl bg-red-500/20 py-2.5 hover:bg-red-500/30 text-red-300">
              <Trash2 className="w-5 h-5" /><span className="text-[10px]">Eliminar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
