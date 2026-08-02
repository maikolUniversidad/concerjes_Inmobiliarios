'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Wrench, MapPin, User, Tag, Camera, Loader2, Send, Clock, RefreshCw, PencilLine,
  GitBranch, Image as ImageIcon, MessageSquare, FilePlus2, MoveRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { ESTADOS_MAQ, ESTADO_MAQ_META, subirFotoMaq } from '../estados'

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export interface MaqDetalle {
  id: string; codigo: string; nombre: string; tipo: string | null; marca: string | null
  modelo: string | null; serial: string | null; estado: string
  ubicacion_sede_id: string | null; ubicacion_texto: string | null; responsable: string | null
  imagen_url: string | null; fecha_adquisicion: string | null; valor: number | null
  observaciones: string | null; created_at: string; sedes: { id: string; nombre: string } | null
}
export interface MaqEvento {
  id: string; tipo: string; estado_anterior: string | null; estado_nuevo: string | null
  ubicacion: string | null; descripcion: string; foto_path: string | null
  usuario_nombre: string | null; usuario_email: string | null; created_at: string
}
export interface SedeOpt { id: string; nombre: string }

const EVENTO_ICON: Record<string, { icon: typeof Wrench; cls: string }> = {
  CREACION: { icon: FilePlus2, cls: 'bg-gray-100 text-gray-600' },
  ESTADO: { icon: GitBranch, cls: 'bg-blue-100 text-blue-600' },
  UBICACION: { icon: MoveRight, cls: 'bg-indigo-100 text-indigo-600' },
  FOTO: { icon: ImageIcon, cls: 'bg-emerald-100 text-emerald-600' },
  MANTENIMIENTO: { icon: Wrench, cls: 'bg-amber-100 text-amber-600' },
  COMENTARIO: { icon: MessageSquare, cls: 'bg-purple-100 text-purple-600' },
}
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

export function MaquinariaDetalleClient({ maquina, eventos, sedes, puedeGestionar }: {
  maquina: MaqDetalle; eventos: MaqEvento[]; sedes: SedeOpt[]; puedeGestionar: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const [nuevoEstado, setNuevoEstado] = useState(maquina.estado)
  const [sedeId, setSedeId] = useState(maquina.ubicacion_sede_id ?? '')
  const [ubicTexto, setUbicTexto] = useState(maquina.ubicacion_texto ?? '')
  const [comentario, setComentario] = useState('')

  const meta = ESTADO_MAQ_META[maquina.estado] ?? { label: maquina.estado, cls: 'bg-gray-100 text-gray-600' }
  const fotos = eventos.filter(e => e.tipo === 'FOTO' && e.foto_path)

  function correr(fn: () => Promise<{ error?: string } | void>, ok: string) {
    startTransition(async () => {
      try { const r = await fn(); if (r && 'error' in r && r.error) { toast.error(r.error); return } toast.success(ok); router.refresh() }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    })
  }

  const cambiarEstado = () => {
    if (nuevoEstado === maquina.estado) { toast.message('El estado no cambió.'); return }
    correr(async () => { const { error } = await sb.from('maquinaria').update({ estado: nuevoEstado }).eq('id', maquina.id); if (error) return { error: error.message } }, 'Estado actualizado.')
  }
  const cambiarUbicacion = () => {
    correr(async () => {
      const { error } = await sb.from('maquinaria').update({ ubicacion_sede_id: sedeId || null, ubicacion_texto: ubicTexto.trim() || null }).eq('id', maquina.id)
      if (error) return { error: error.message }
    }, 'Ubicación actualizada.')
  }
  async function onFoto(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Sube una imagen.'); return }
    correr(async () => {
      const url = await subirFotoMaq(sb, file)
      const { data: { user } } = await sb.auth.getUser()
      const { data: u } = await sb.from('usuarios').select('nombre, email').eq('id', user?.id).single()
      await sb.from('maquinaria').update({ imagen_url: url }).eq('id', maquina.id)
      await sb.from('maquinaria_eventos').insert({ maquinaria_id: maquina.id, tipo: 'FOTO', descripcion: 'Foto agregada', foto_path: url, usuario_id: user?.id ?? null, usuario_email: u?.email ?? null, usuario_nombre: u?.nombre ?? null })
      await logActivity(sb, { accion: 'FOTO', modulo: 'Maquinaria', descripcion: `Foto agregada a ${maquina.codigo}`, entidad: 'maquinaria', entidad_id: maquina.id })
    }, 'Foto agregada.')
  }
  const comentar = () => {
    if (!comentario.trim()) return
    correr(async () => {
      const { data: { user } } = await sb.auth.getUser()
      const { data: u } = await sb.from('usuarios').select('nombre, email').eq('id', user?.id).single()
      const { error } = await sb.from('maquinaria_eventos').insert({ maquinaria_id: maquina.id, tipo: 'COMENTARIO', descripcion: comentario.trim(), usuario_id: user?.id ?? null, usuario_email: u?.email ?? null, usuario_nombre: u?.nombre ?? null })
      if (error) return { error: error.message }
      setComentario('')
    }, 'Comentario agregado.')
  }

  return (
    <div className="space-y-5">
      {/* Ficha */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="grid sm:grid-cols-[220px_1fr]">
          <div className="relative aspect-video sm:aspect-auto sm:h-full min-h-[180px] bg-gray-50">
            {maquina.imagen_url
              ? <Image src={maquina.imagen_url} alt={maquina.nombre} fill className="object-cover" sizes="220px" />
              : <div className="flex h-full w-full items-center justify-center text-gray-300"><Wrench className="w-12 h-12" /></div>}
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{maquina.codigo}</span>
              <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${meta.cls}`}>{meta.label}</span>
            </div>
            <h1 className="mt-1.5 font-heading font-bold text-xl text-gray-900">{maquina.nombre}</h1>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {maquina.tipo && <p className="flex items-center gap-1.5 text-gray-600"><Tag className="w-3.5 h-3.5 text-gray-400" /> {maquina.tipo}</p>}
              <p className="flex items-center gap-1.5 text-gray-600"><MapPin className="w-3.5 h-3.5 text-gray-400" /> {maquina.sedes?.nombre ?? maquina.ubicacion_texto ?? 'Sin ubicación'}</p>
              {maquina.responsable && <p className="flex items-center gap-1.5 text-gray-600"><User className="w-3.5 h-3.5 text-gray-400" /> {maquina.responsable}</p>}
              {(maquina.marca || maquina.modelo) && <p className="text-gray-500">{[maquina.marca, maquina.modelo].filter(Boolean).join(' · ')}</p>}
              {maquina.serial && <p className="text-gray-500">Serial: {maquina.serial}</p>}
              {maquina.valor != null && <p className="text-gray-700 font-medium">{cop.format(maquina.valor)}</p>}
            </div>
            {maquina.observaciones && <p className="mt-2 font-body text-sm text-gray-500">{maquina.observaciones}</p>}
          </div>
        </div>
      </div>

      {/* Acciones rápidas */}
      {puedeGestionar && (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Estado */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="font-heading font-semibold text-sm text-gray-800 mb-2 flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-brand-green" /> Cambiar estado</p>
            <div className="flex gap-2">
              <select value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value)} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green">
                {ESTADOS_MAQ.map(e => <option key={e} value={e}>{ESTADO_MAQ_META[e].label}</option>)}
              </select>
              <button onClick={cambiarEstado} disabled={pending} className="bg-brand-green text-white text-sm font-semibold px-4 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">Aplicar</button>
            </div>
          </div>
          {/* Ubicación */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="font-heading font-semibold text-sm text-gray-800 mb-2 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-brand-green" /> Cambiar ubicación</p>
            <div className="flex gap-2">
              <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-sm outline-none focus:border-brand-green">
                <option value="">— Sede —</option>
                {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              <input value={ubicTexto} onChange={(e) => setUbicTexto(e.target.value)} placeholder="Detalle" className="w-24 rounded-lg border border-gray-200 px-2 py-2 text-sm outline-none focus:border-brand-green" />
              <button onClick={cambiarUbicacion} disabled={pending} className="bg-brand-green text-white text-sm font-semibold px-3 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">OK</button>
            </div>
          </div>
          {/* Foto + comentario */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:col-span-2 flex flex-col sm:flex-row gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={pending}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Tomar / subir foto
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onFoto(fl); e.target.value = '' }} />
            <div className="flex flex-1 items-center gap-2">
              <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Agregar comentario a la bitácora…" className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
              <button onClick={comentar} disabled={pending || !comentario.trim()} className="flex items-center gap-1.5 bg-brand-green text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50"><Send className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Galería de fotos */}
      {fotos.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="font-heading font-semibold text-sm text-gray-800 mb-3 flex items-center gap-1.5"><ImageIcon className="w-4 h-4 text-brand-green" /> Fotos ({fotos.length})</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {fotos.map(f => (
              <a key={f.id} href={f.foto_path!} target="_blank" rel="noopener" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.foto_path!} alt="Foto" className="h-24 w-32 rounded-lg object-cover border border-gray-100" />
                <span className="mt-1 block text-[10px] text-gray-400">{new Date(f.created_at).toLocaleDateString('es-CO')}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Trazabilidad */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2"><Clock className="w-4 h-4 text-brand-green" /> Trazabilidad</h2>
        </div>
        <ol className="p-4 space-y-1">
          {eventos.length === 0 && <p className="py-4 text-center font-body text-sm text-gray-400">Sin eventos.</p>}
          {eventos.map(e => {
            const ic = EVENTO_ICON[e.tipo] ?? { icon: PencilLine, cls: 'bg-gray-100 text-gray-600' }
            return (
              <li key={e.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${ic.cls}`}><ic.icon className="w-4 h-4" /></span>
                  <span className="w-px flex-1 bg-gray-100" />
                </div>
                <div className="pb-4 min-w-0 flex-1">
                  <p className="font-body text-sm text-gray-800">{e.descripcion}</p>
                  {e.ubicacion && e.tipo === 'UBICACION' && <p className="font-body text-xs text-gray-500">→ {e.ubicacion}</p>}
                  <p className="font-body text-[11px] text-gray-400 mt-0.5">{e.usuario_nombre ?? e.usuario_email ?? 'Sistema'} · {fechaHora(e.created_at)}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
