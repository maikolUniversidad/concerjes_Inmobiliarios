'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, UserPlus, Trash2, Upload, Star, Check, X, MapPin, Power } from 'lucide-react'
import { toast } from 'sonner'
import { getGestionSupabase } from '@/lib/supabase/gestion'

const BUCKET = 'servicios-hogar'

interface Tipo { id: string; nombre: string; icono: string | null }
interface Concerje {
  id: string; nombre: string; foto_url: string | null; bio: string | null
  anios_experiencia: number | null; ciudad: string | null; calificacion_prom: number
  servicios_count: number; disponible: boolean; activo: boolean
}

export function ConcerjesAdmin() {
  const [items, setItems] = useState<Concerje[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [habil, setHabil] = useState<Record<string, Set<string>>>({}) // concerje_id -> set(tipo_id)
  const [cargando, setCargando] = useState(true)
  const [nuevo, setNuevo] = useState(false)

  async function cargar() {
    const sb = getGestionSupabase()
    const [{ data: cs }, { data: ts }, { data: hs }] = await Promise.all([
      sb.from('concerjes_hogar').select('id, nombre, foto_url, bio, anios_experiencia, ciudad, calificacion_prom, servicios_count, disponible, activo').order('orden').order('created_at', { ascending: false }),
      sb.from('tipos_servicio_hogar').select('id, nombre, icono').eq('activo', true).order('orden'),
      sb.from('concerje_servicio_hogar').select('concerje_id, tipo_id').eq('activo', true),
    ])
    setItems((cs as Concerje[]) ?? [])
    setTipos((ts as Tipo[]) ?? [])
    const map: Record<string, Set<string>> = {}
    for (const h of (hs as { concerje_id: string; tipo_id: string }[]) ?? []) (map[h.concerje_id] ??= new Set()).add(h.tipo_id)
    setHabil(map)
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  async function toggleServicio(concerjeId: string, tipoId: string) {
    const sb = getGestionSupabase()
    const activo = habil[concerjeId]?.has(tipoId)
    if (activo) {
      await sb.from('concerje_servicio_hogar').delete().eq('concerje_id', concerjeId).eq('tipo_id', tipoId)
    } else {
      await sb.from('concerje_servicio_hogar').upsert({ concerje_id: concerjeId, tipo_id: tipoId, activo: true })
    }
    cargar()
  }

  async function toggleCampo(c: Concerje, campo: 'disponible' | 'activo') {
    const sb = getGestionSupabase()
    await sb.from('concerjes_hogar').update({ [campo]: !c[campo] }).eq('id', c.id)
    cargar()
  }

  async function eliminar(id: string) {
    const sb = getGestionSupabase()
    const { error } = await sb.from('concerjes_hogar').delete().eq('id', id)
    if (error) { toast.error('No se pudo eliminar.'); return }
    toast.success('Concerje eliminado.')
    cargar()
  }

  return (
    <div className="space-y-5">
      {!nuevo && (
        <button onClick={() => setNuevo(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
          <UserPlus className="h-4 w-4" /> Agregar concerje
        </button>
      )}

      {nuevo && <FormConcerje onCerrar={() => setNuevo(false)} onGuardado={() => { setNuevo(false); cargar() }} />}

      {cargando ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>
      ) : items.length === 0 && !nuevo ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">Aún no hay concerjes registrados.</p>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <div key={c.id} className={`rounded-2xl border bg-white p-5 ${c.activo ? 'border-gray-200' : 'border-amber-300'}`}>
              <div className="flex items-start gap-4">
                {c.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.foto_url} alt={c.nombre} className="h-14 w-14 rounded-full object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10 font-heading text-xl font-bold text-brand-green">{c.nombre.charAt(0)}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-heading font-bold text-gray-900">{c.nombre}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
                    <span className="flex items-center gap-1 text-amber-600"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {Number(c.calificacion_prom).toFixed(1)} · {c.servicios_count} serv.</span>
                    {c.ciudad && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.ciudad}</span>}
                    {!!c.anios_experiencia && <span>{c.anios_experiencia} años exp.</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => toggleCampo(c, 'disponible')} title={c.disponible ? 'Marcar ocupado' : 'Marcar disponible'}
                    className={`rounded-lg px-2.5 py-2 text-xs font-semibold ${c.disponible ? 'bg-green-100 text-brand-green' : 'bg-gray-100 text-gray-400'}`}>
                    {c.disponible ? 'Disponible' : 'Ocupado'}
                  </button>
                  <button onClick={() => toggleCampo(c, 'activo')} title={c.activo ? 'Desactivar' : 'Activar'} className="rounded-lg bg-gray-100 p-2 text-gray-500 hover:bg-gray-200">
                    <Power className="h-4 w-4" />
                  </button>
                  <button onClick={() => eliminar(c.id)} title="Eliminar" className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Servicios habilitados */}
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Habilitado para</p>
                <div className="flex flex-wrap gap-2">
                  {tipos.map((t) => {
                    const on = habil[c.id]?.has(t.id)
                    return (
                      <button key={t.id} onClick={() => toggleServicio(c.id, t.id)}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${on ? 'border-brand-green bg-brand-green/10 text-brand-green' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {on ? <Check className="h-3.5 w-3.5" /> : null}{t.icono} {t.nombre}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FormConcerje({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState('')
  const [ciudad, setCiudad] = useState('Bogotá')
  const [exp, setExp] = useState('')
  const [bio, setBio] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function elegirFoto(f: File | null) {
    setFoto(f)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function guardar() {
    if (!nombre.trim()) { toast.error('Escribe el nombre.'); return }
    setGuardando(true)
    const sb = getGestionSupabase()
    let foto_url: string | null = null
    if (foto) {
      const ext = foto.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `concerjes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await sb.storage.from(BUCKET).upload(path, foto, { contentType: foto.type, upsert: false })
      if (!error) foto_url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    }
    const { error } = await sb.from('concerjes_hogar').insert({
      nombre: nombre.trim(), ciudad: ciudad.trim() || 'Bogotá',
      anios_experiencia: exp ? parseInt(exp) : 0, bio: bio.trim() || null, foto_url,
    })
    setGuardando(false)
    if (error) { toast.error('No se pudo guardar.'); return }
    toast.success('Concerje agregado.')
    onGuardado()
  }

  return (
    <div className="space-y-3 rounded-2xl border border-brand-green/30 bg-brand-green-bg/40 p-5">
      <div className="flex items-center justify-between">
        <p className="font-heading font-bold text-gray-800">Nuevo concerje</p>
        <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-gray-300"><Upload className="h-5 w-5" /></div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)} />
        <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Foto (opcional)</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
        <input value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ciudad" className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
      </div>
      <input value={exp} onChange={(e) => setExp(e.target.value)} type="number" placeholder="Años de experiencia" className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} placeholder="Breve descripción / especialidad" className="w-full resize-none rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
      <button onClick={guardar} disabled={guardando} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
      </button>
    </div>
  )
}
