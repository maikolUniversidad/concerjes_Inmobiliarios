'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, Loader2, Trash2, IdCard, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import type { EmpresaOption, SedeOption, PersonaRow } from './PersonasClient'

const TIPO_DOC = ['CC', 'CE', 'TI', 'PA', 'PEP', 'NIT'] as const
const ESTADOS = ['ACTIVO', 'RETIRADO', 'SUSPENDIDO'] as const

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'
const labelCls = 'font-body font-semibold text-xs text-gray-600 block mb-1'

interface Props {
  persona: PersonaRow | null
  empresas: EmpresaOption[]
  sedes: SedeOption[]
  onClose: () => void
  onSaved: (p: PersonaRow) => void
  onDeleted: (id: string) => void
}

const SELECT = `id, tipo_doc, documento, nombres, apellidos, cargo, empresa_usuaria_id, sede_id, fecha_ingreso, estado, email, telefono, direccion, eps, arl, created_at, empresas_usuarias(id, nombre), sedes(id, nombre)`

export function PersonaForm({ persona, empresas, sedes, onClose, onSaved, onDeleted }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const isNew = persona === null

  const [f, setF] = useState({
    tipo_doc: persona?.tipo_doc ?? 'CC',
    documento: persona?.documento ?? '',
    nombres: persona?.nombres ?? '',
    apellidos: persona?.apellidos ?? '',
    cargo: persona?.cargo ?? '',
    empresa_usuaria_id: persona?.empresa_usuaria_id ?? '',
    sede_id: persona?.sede_id ?? '',
    fecha_ingreso: persona?.fecha_ingreso ?? '',
    estado: persona?.estado ?? 'ACTIVO',
    email: persona?.email ?? '',
    telefono: persona?.telefono ?? '',
    direccion: persona?.direccion ?? '',
    eps: persona?.eps ?? '',
    arl: persona?.arl ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  async function guardar() {
    if (!f.documento.trim() || !f.nombres.trim() || !f.apellidos.trim()) {
      setError('Documento, nombres y apellidos son obligatorios.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      tipo_doc: f.tipo_doc,
      documento: f.documento.trim(),
      nombres: f.nombres.trim(),
      apellidos: f.apellidos.trim(),
      cargo: f.cargo.trim() || null,
      empresa_usuaria_id: f.empresa_usuaria_id || null,
      sede_id: f.sede_id || null,
      fecha_ingreso: f.fecha_ingreso || null,
      estado: f.estado,
      email: f.email.trim() || null,
      telefono: f.telefono.trim() || null,
      direccion: f.direccion.trim() || null,
      eps: f.eps.trim() || null,
      arl: f.arl.trim() || null,
    }
    try {
      if (isNew) {
        const { data, error: err } = await sb.from('personas').insert(payload).select(SELECT).single()
        if (err || !data) { setError(err?.message ?? 'No se pudo crear la persona.'); return }
        await logActivity(sb, { accion: 'CREAR', modulo: 'Gestión Humana', descripcion: `Persona creada: ${data.nombres} ${data.apellidos}`, entidad: 'personas', entidad_id: data.id })
        onSaved(data as PersonaRow)
        toast.success('Persona creada.')
      } else {
        const { data, error: err } = await sb.from('personas').update(payload).eq('id', persona!.id).select(SELECT).single()
        if (err || !data) { setError(err?.message ?? 'No se pudo actualizar.'); return }
        await logActivity(sb, { accion: 'EDITAR', modulo: 'Gestión Humana', descripcion: `Persona editada: ${data.nombres} ${data.apellidos}`, entidad: 'personas', entidad_id: data.id })
        onSaved(data as PersonaRow)
        toast.success('Cambios guardados.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function eliminar() {
    if (!persona) return
    if (!window.confirm(`¿Eliminar a ${persona.nombres} ${persona.apellidos}? Se eliminarán también sus documentos.`)) return
    setSaving(true)
    try {
      await sb.from('personas').delete().eq('id', persona.id)
      await logActivity(sb, { accion: 'ELIMINAR', modulo: 'Gestión Humana', descripcion: `Persona eliminada: ${persona.nombres} ${persona.apellidos}`, entidad: 'personas', entidad_id: persona.id })
      onDeleted(persona.id)
      toast.success('Persona eliminada.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <IdCard className="h-4 w-4 text-brand-green" />
          <h2 className="font-heading font-bold text-base text-gray-900">{isNew ? 'Nueva persona' : 'Editar persona'}</h2>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {error && <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 font-body text-sm text-red-700">{error}</div>}

        {/* Documento */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>Tipo</label>
            <select value={f.tipo_doc} onChange={(e) => set('tipo_doc', e.target.value)} className={inputCls}>
              {TIPO_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Documento <span className="text-red-500">*</span></label>
            <input value={f.documento} onChange={(e) => set('documento', e.target.value)} className={inputCls} placeholder="1020304050" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Nombres <span className="text-red-500">*</span></label>
            <input value={f.nombres} onChange={(e) => set('nombres', e.target.value)} className={inputCls} placeholder="María Fernanda" />
          </div>
          <div>
            <label className={labelCls}>Apellidos <span className="text-red-500">*</span></label>
            <input value={f.apellidos} onChange={(e) => set('apellidos', e.target.value)} className={inputCls} placeholder="Gómez Ruiz" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Cargo</label>
          <input value={f.cargo} onChange={(e) => set('cargo', e.target.value)} className={inputCls} placeholder="Servicios Generales" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Empresa usuaria</label>
            <select value={f.empresa_usuaria_id} onChange={(e) => set('empresa_usuaria_id', e.target.value)} className={inputCls}>
              <option value="">— Ninguna —</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Sede</label>
            <select value={f.sede_id} onChange={(e) => set('sede_id', e.target.value)} className={inputCls}>
              <option value="">— Ninguna —</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Fecha de ingreso</label>
            <input type="date" value={f.fecha_ingreso ?? ''} onChange={(e) => set('fecha_ingreso', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Estado</label>
            <select value={f.estado} onChange={(e) => set('estado', e.target.value)} className={inputCls}>
              {ESTADOS.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Email</label>
            <input value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} placeholder="correo@ejemplo.com" />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} className={inputCls} placeholder="3001234567" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Dirección</label>
          <input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} className={inputCls} placeholder="Cra 10 # 20-30" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>EPS</label>
            <input value={f.eps} onChange={(e) => set('eps', e.target.value)} className={inputCls} placeholder="Sura EPS" />
          </div>
          <div>
            <label className={labelCls}>ARL</label>
            <input value={f.arl} onChange={(e) => set('arl', e.target.value)} className={inputCls} placeholder="ARL Sura" />
          </div>
        </div>

        {/* Acceso a documentos (solo al editar una persona existente) */}
        {!isNew && persona && (
          <Link
            href={`/gestion-humana/documentos?persona=${persona.id}`}
            className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 hover:border-brand-green hover:bg-green-50/40 transition-colors"
          >
            <span className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-brand-green" />
              <span className="font-body text-sm font-medium text-gray-700">Ver y subir documentos</span>
            </span>
            <span className="font-body text-xs text-brand-green">Abrir →</span>
          </Link>
        )}
      </div>

      <div className="border-t border-gray-100 px-5 py-4 space-y-2 shrink-0">
        <button onClick={guardar} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isNew ? 'Crear persona' : 'Guardar cambios'}
        </button>
        {!isNew && (
          <button onClick={eliminar} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors">
            <Trash2 className="h-4 w-4" /> Eliminar persona
          </button>
        )}
      </div>
    </div>
  )
}
