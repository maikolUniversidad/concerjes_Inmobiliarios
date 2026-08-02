'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { X, Loader2, Trash2, Camera, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { ESTADOS_MAQ, ESTADO_MAQ_META, subirFotoMaq } from './estados'
import type { MaquinariaRow, SedeOpt } from './MaquinariaClient'

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'
const labelCls = 'font-body font-semibold text-xs text-gray-600 block mb-1'

const SELECT = 'id, codigo, nombre, tipo, marca, modelo, serial, estado, ubicacion_sede_id, ubicacion_texto, responsable, imagen_url, fecha_adquisicion, valor, observaciones, created_at, sedes:ubicacion_sede_id(id, nombre)'

interface Props {
  maquina: MaquinariaRow | null
  sedes: SedeOpt[]
  onClose: () => void
  onSaved: (m: MaquinariaRow) => void
  onDeleted: (id: string) => void
}

export function MaquinariaForm({ maquina, sedes, onClose, onSaved, onDeleted }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const fileRef = useRef<HTMLInputElement>(null)
  const isNew = maquina === null

  const [f, setF] = useState({
    codigo: maquina?.codigo ?? '',
    nombre: maquina?.nombre ?? '',
    tipo: maquina?.tipo ?? '',
    marca: maquina?.marca ?? '',
    modelo: maquina?.modelo ?? '',
    serial: maquina?.serial ?? '',
    estado: maquina?.estado ?? 'OPERATIVA',
    ubicacion_sede_id: maquina?.ubicacion_sede_id ?? '',
    ubicacion_texto: maquina?.ubicacion_texto ?? '',
    responsable: maquina?.responsable ?? '',
    fecha_adquisicion: maquina?.fecha_adquisicion ?? '',
    valor: maquina?.valor != null ? String(maquina.valor) : '',
    observaciones: maquina?.observaciones ?? '',
  })
  const [imagenUrl, setImagenUrl] = useState<string | null>(maquina?.imagen_url ?? null)
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))

  async function onFoto(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Sube una imagen.'); return }
    if (file.size > 6 * 1024 * 1024) { toast.error('La foto supera 6 MB.'); return }
    setSubiendoFoto(true)
    try {
      const url = await subirFotoMaq(sb, file)
      setImagenUrl(url)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo subir la foto.') }
    finally { setSubiendoFoto(false) }
  }

  async function guardar() {
    if (!f.codigo.trim() || !f.nombre.trim()) { setError('Código y nombre son obligatorios.'); return }
    setSaving(true); setError(null)
    const payload = {
      codigo: f.codigo.trim(), nombre: f.nombre.trim(), tipo: f.tipo.trim() || null,
      marca: f.marca.trim() || null, modelo: f.modelo.trim() || null, serial: f.serial.trim() || null,
      estado: f.estado, ubicacion_sede_id: f.ubicacion_sede_id || null,
      ubicacion_texto: f.ubicacion_texto.trim() || null, responsable: f.responsable.trim() || null,
      imagen_url: imagenUrl, fecha_adquisicion: f.fecha_adquisicion || null,
      valor: f.valor ? Number(f.valor) : null, observaciones: f.observaciones.trim() || null,
    }
    try {
      if (isNew) {
        const { data, error: err } = await sb.from('maquinaria').insert(payload).select(SELECT).single()
        if (err || !data) { setError(err?.message?.includes('duplicate') ? 'Ya existe una máquina con ese código.' : (err?.message ?? 'No se pudo crear.')); return }
        await logActivity(sb, { accion: 'CREAR', modulo: 'Maquinaria', descripcion: `Maquinaria creada: ${data.codigo} — ${data.nombre}`, entidad: 'maquinaria', entidad_id: data.id })
        onSaved(data as MaquinariaRow); toast.success('Maquinaria creada.')
      } else {
        const { data, error: err } = await sb.from('maquinaria').update(payload).eq('id', maquina!.id).select(SELECT).single()
        if (err || !data) { setError(err?.message ?? 'No se pudo actualizar.'); return }
        await logActivity(sb, { accion: 'EDITAR', modulo: 'Maquinaria', descripcion: `Maquinaria editada: ${data.codigo}`, entidad: 'maquinaria', entidad_id: data.id })
        onSaved(data as MaquinariaRow); toast.success('Cambios guardados.')
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar.') }
    finally { setSaving(false) }
  }

  async function eliminar() {
    if (!maquina) return
    if (!window.confirm(`¿Eliminar la máquina ${maquina.codigo}?`)) return
    setSaving(true)
    try {
      await sb.from('maquinaria').delete().eq('id', maquina.id)
      await logActivity(sb, { accion: 'ELIMINAR', modulo: 'Maquinaria', descripcion: `Maquinaria eliminada: ${maquina.codigo}`, entidad: 'maquinaria', entidad_id: maquina.id })
      onDeleted(maquina.id); toast.success('Maquinaria eliminada.')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-brand-green" />
          <h2 className="font-heading font-bold text-base text-gray-900">{isNew ? 'Nueva maquinaria' : 'Editar maquinaria'}</h2>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {error && <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 font-body text-sm text-red-700">{error}</div>}

        {/* Foto */}
        <div className="flex items-center gap-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100 border border-gray-200">
            {imagenUrl ? <Image src={imagenUrl} alt="Foto" width={80} height={80} className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center text-gray-300"><Wrench className="w-7 h-7" /></div>}
          </div>
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendoFoto}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60">
              {subiendoFoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Tomar / subir foto
            </button>
            {imagenUrl && <button type="button" onClick={() => setImagenUrl(null)} className="text-xs text-gray-400 hover:text-red-600">Quitar</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onFoto(fl); e.target.value = '' }} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Código <span className="text-red-500">*</span></label>
            <input value={f.codigo} onChange={(e) => set('codigo', e.target.value)} className={inputCls} placeholder="MAQ-001" />
          </div>
          <div>
            <label className={labelCls}>Estado</label>
            <select value={f.estado} onChange={(e) => set('estado', e.target.value)} className={inputCls}>
              {ESTADOS_MAQ.map(e => <option key={e} value={e}>{ESTADO_MAQ_META[e].label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Nombre <span className="text-red-500">*</span></label>
          <input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} className={inputCls} placeholder="Brilladora industrial" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Tipo</label><input value={f.tipo} onChange={(e) => set('tipo', e.target.value)} className={inputCls} placeholder="Brilladora" /></div>
          <div><label className={labelCls}>Serial</label><input value={f.serial} onChange={(e) => set('serial', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Marca</label><input value={f.marca} onChange={(e) => set('marca', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Modelo</label><input value={f.modelo} onChange={(e) => set('modelo', e.target.value)} className={inputCls} /></div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Sede / ubicación</label>
            <select value={f.ubicacion_sede_id} onChange={(e) => set('ubicacion_sede_id', e.target.value)} className={inputCls}>
              <option value="">— Ninguna —</option>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Ubicación (detalle)</label><input value={f.ubicacion_texto} onChange={(e) => set('ubicacion_texto', e.target.value)} className={inputCls} placeholder="Bodega, piso 2…" /></div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Responsable</label><input value={f.responsable} onChange={(e) => set('responsable', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Fecha adquisición</label><input type="date" value={f.fecha_adquisicion ?? ''} onChange={(e) => set('fecha_adquisicion', e.target.value)} className={inputCls} /></div>
        </div>

        <div>
          <label className={labelCls}>Valor (COP)</label>
          <input type="number" value={f.valor} onChange={(e) => set('valor', e.target.value)} className={inputCls} placeholder="1500000" />
        </div>
        <div>
          <label className={labelCls}>Observaciones</label>
          <textarea value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        </div>
      </div>

      <div className="border-t border-gray-100 px-5 py-4 space-y-2 shrink-0">
        <button onClick={guardar} disabled={saving || subiendoFoto}
          className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} {isNew ? 'Crear maquinaria' : 'Guardar cambios'}
        </button>
        {!isNew && (
          <button onClick={eliminar} disabled={saving} className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors">
            <Trash2 className="h-4 w-4" /> Eliminar
          </button>
        )}
      </div>
    </div>
  )
}
