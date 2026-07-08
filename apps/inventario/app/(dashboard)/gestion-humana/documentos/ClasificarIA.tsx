'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Sparkles, UploadCloud, Loader2, CheckCircle2, AlertCircle, X, Wand2, Brain,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { imagenADataUrl } from './escaneo'
import { tiposParaSelect, type TipoDoc } from './tipos'
import { PersonaPicker } from './PersonaPicker'
import type { PersonaLite } from './DocumentosClient'

type Estado = 'analizando' | 'listo' | 'subiendo' | 'subido' | 'error'

interface Item {
  id: string
  file: File
  thumb: string
  tipoId: string
  confianza: number
  texto: string
  estado: Estado
  error?: string
}

interface Props {
  personas: PersonaLite[]
  tipos: TipoDoc[]
  initialPersonaId?: string
}

function sanitize(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(-80)
}
function nuevoId() {
  return globalThis.crypto?.randomUUID?.() ?? `it-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

export function ClasificarIA({ personas, tipos, initialPersonaId = '' }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [personaId, setPersonaId] = useState(initialPersonaId)
  const [items, setItems] = useState<Item[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const opciones = useMemo(() => tiposParaSelect(tipos), [tipos])
  const personaSel = personas.find((p) => p.id === personaId) ?? null

  async function agregar(list: FileList | null) {
    if (!list) return
    const arr = Array.from(list).filter((f) => f.type.startsWith('image/'))
    for (const file of arr) {
      let thumb = ''
      try { thumb = await imagenADataUrl(file, 1600, 0.8) } catch { continue }
      const item: Item = { id: nuevoId(), file, thumb, tipoId: '', confianza: 0, texto: '', estado: 'analizando' }
      setItems((prev) => [...prev, item])
      void clasificar(item.id, thumb)
    }
  }

  async function clasificar(id: string, dataUrl: string) {
    try {
      const res = await fetch('/api/gestion-humana/analizar-doc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'clasificar', imagen: dataUrl }),
      })
      const j = await res.json()
      setItems((prev) => prev.map((it) => it.id === id
        ? { ...it, tipoId: j.tipoId ?? '', confianza: j.confianza ?? 0, texto: j.texto ?? '', estado: 'listo' }
        : it))
    } catch {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, estado: 'error', error: 'No se pudo analizar' } : it))
    }
  }

  function setTipo(id: string, tipoId: string) {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, tipoId } : it))
  }
  function quitar(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  async function subir() {
    if (!personaId) { toast.error('Selecciona la persona.'); return }
    const listos = items.filter((it) => (it.estado === 'listo' || it.estado === 'error') && it.tipoId)
    if (listos.length === 0) { toast.error('Asigna un tipo a al menos un documento.'); return }
    setSubiendo(true)
    const { data: { user } } = await sb.auth.getUser()
    let ok = 0

    for (const it of listos) {
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, estado: 'subiendo' } : x))
      try {
        const id = nuevoId()
        const path = `${personaId}/${id}-${sanitize(it.file.name)}`
        const { error: up } = await sb.storage.from('gestion-humana').upload(path, it.file, {
          contentType: it.file.type || 'application/octet-stream', upsert: false,
        })
        if (up) throw up
        const { error: db } = await sb.from('documentos_persona').insert({
          persona_id: personaId, tipo_documental_id: it.tipoId, nombre_archivo: it.file.name,
          archivo_path: path, mime: it.file.type || null, tamano: it.file.size, subido_por: user?.id ?? null,
        })
        if (db) throw db
        // Aprendizaje: guarda el texto como referencia confirmada del tipo
        if (it.texto) {
          void sb.from('tipos_documentales_refs').insert({ tipo_id: it.tipoId, texto: it.texto, origen: 'confirmado', created_by: user?.id ?? null })
        }
        ok++
        setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, estado: 'subido' } : x))
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, estado: 'error', error: (e as any)?.message || 'Error al subir' } : x))
      }
    }

    if (ok > 0) {
      await logActivity(sb, {
        accion: 'CLASIFICAR', modulo: 'Gestión Humana',
        descripcion: `Clasificó y subió ${ok} documento(s) de ${personaSel?.nombres} ${personaSel?.apellidos}`,
        entidad: 'documentos_persona', entidad_id: personaId,
      })
      toast.success(`${ok} documento(s) subido(s) y clasificado(s).`)
      setItems((prev) => prev.filter((x) => x.estado !== 'subido'))
    }
    setSubiendo(false)
  }

  const analizando = items.some((it) => it.estado === 'analizando')
  const listosParaSubir = items.filter((it) => it.tipoId && it.estado !== 'subido' && it.estado !== 'subiendo').length

  function badgeConfianza(it: Item) {
    if (it.estado === 'analizando') return <span className="flex items-center gap-1 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Analizando…</span>
    if (!it.tipoId) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">Sin clasificar</span>
    const c = it.confianza
    const cls = c >= 70 ? 'bg-green-100 text-green-700' : c >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
    const lbl = c >= 70 ? 'Alta' : c >= 40 ? 'Media' : 'Baja'
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{lbl} · {c}%</span>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-green/15 bg-brand-green/5 p-3">
        <p className="flex items-center gap-1.5 font-body text-xs text-gray-600">
          <Wand2 className="w-3.5 h-3.5 text-brand-green" />
          Sube uno o varios documentos: la IA los <strong className="text-gray-700">clasifica automáticamente</strong> por tipo documental. Revisa, corrige si hace falta y confirma. Cada confirmación <strong className="text-gray-700">entrena</strong> el sistema.
        </p>
      </div>

      {/* Persona */}
      <div>
        <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Persona <span className="text-red-500">*</span></label>
        <PersonaPicker personas={personas} value={personaId} onChange={setPersonaId} placeholder="¿A quién pertenecen estos documentos?" />
      </div>

      {/* Dropzone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); agregar(e.dataTransfer.files) }}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-200 bg-white py-8 flex flex-col items-center justify-center gap-2 hover:border-brand-green hover:bg-green-50/40 transition-colors"
      >
        <UploadCloud className="w-8 h-8 text-gray-300" />
        <p className="font-body text-sm text-gray-600">Haz clic o arrastra imágenes de documentos</p>
        <p className="font-body text-xs text-gray-400">Se clasifican solos con IA · uno o varios a la vez</p>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
          onChange={(e) => { agregar(e.target.files); e.target.value = '' }} />
      </div>

      {/* Lista de items */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-2.5 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.thumb} alt={it.file.name} className="h-14 w-11 rounded object-cover border border-gray-100 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-gray-800 truncate">{it.file.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={it.tipoId}
                    onChange={(e) => setTipo(it.id, e.target.value)}
                    disabled={it.estado === 'analizando' || it.estado === 'subiendo' || it.estado === 'subido'}
                    className="max-w-[220px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-brand-green bg-white"
                  >
                    <option value="">— Sin clasificar —</option>
                    {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  {badgeConfianza(it)}
                </div>
              </div>
              {it.estado === 'subido' ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                : it.estado === 'subiendo' ? <Loader2 className="w-5 h-5 text-gray-400 animate-spin shrink-0" />
                : it.estado === 'error' ? <span title={it.error}><AlertCircle className="w-5 h-5 text-red-500 shrink-0" /></span>
                : (
                  <button onClick={() => quitar(it.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
            </div>
          ))}

          <button onClick={subir} disabled={subiendo || analizando || listosParaSubir === 0 || !personaId}
            className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {analizando ? 'Clasificando…' : subiendo ? 'Subiendo…' : `Confirmar y subir ${listosParaSubir} documento(s)`}
          </button>
          <p className="flex items-center justify-center gap-1.5 font-body text-[11px] text-gray-400">
            <Brain className="w-3 h-3" /> Cada documento confirmado mejora la clasificación futura de su tipo.
          </p>
        </div>
      )}
    </div>
  )
}
