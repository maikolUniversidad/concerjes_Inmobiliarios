'use client'

import { useState } from 'react'
import { Building2, Plus, Loader2, Pencil, Trash2, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import type { EmpresaOption } from './PersonasClient'

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'

interface Props {
  empresas: EmpresaOption[]
  onChange: (empresas: EmpresaOption[]) => void
}

export function EmpresasUsuariasPanel({ empresas, onChange }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [editId, setEditId] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ nombre: '', nit: '', ciudad: '', contacto: '', telefono: '', email: '' })

  function abrirNuevo() {
    setForm({ nombre: '', nit: '', ciudad: '', contacto: '', telefono: '', email: '' })
    setEditId(null); setCreando(true)
  }
  function abrirEdit(e: EmpresaOption) {
    setForm({ nombre: e.nombre, nit: e.nit ?? '', ciudad: e.ciudad ?? '', contacto: e.contacto ?? '', telefono: e.telefono ?? '', email: e.email ?? '' })
    setEditId(e.id); setCreando(false)
  }
  function cerrar() { setCreando(false); setEditId(null) }

  async function guardar() {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio.'); return }
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(), nit: form.nit.trim() || null, ciudad: form.ciudad.trim() || null,
      contacto: form.contacto.trim() || null, telefono: form.telefono.trim() || null, email: form.email.trim() || null,
    }
    try {
      if (editId) {
        const { data, error } = await sb.from('empresas_usuarias').update(payload).eq('id', editId).select('*').single()
        if (error) throw error
        onChange(empresas.map((e) => (e.id === editId ? (data as EmpresaOption) : e)))
        await logActivity(sb, { accion: 'EDITAR', modulo: 'Gestión Humana', descripcion: `Empresa usuaria editada: ${payload.nombre}`, entidad: 'empresas_usuarias', entidad_id: editId })
      } else {
        const { data, error } = await sb.from('empresas_usuarias').insert(payload).select('*').single()
        if (error) throw error
        onChange([...empresas, data as EmpresaOption].sort((a, b) => a.nombre.localeCompare(b.nombre)))
        await logActivity(sb, { accion: 'CREAR', modulo: 'Gestión Humana', descripcion: `Empresa usuaria creada: ${payload.nombre}`, entidad: 'empresas_usuarias', entidad_id: data.id })
      }
      toast.success('Empresa guardada.')
      cerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function eliminar(e: EmpresaOption) {
    if (!window.confirm(`¿Eliminar "${e.nombre}"? Las personas asignadas quedarán sin empresa.`)) return
    try {
      await sb.from('empresas_usuarias').delete().eq('id', e.id)
      onChange(empresas.filter((x) => x.id !== e.id))
      await logActivity(sb, { accion: 'ELIMINAR', modulo: 'Gestión Humana', descripcion: `Empresa usuaria eliminada: ${e.nombre}`, entidad: 'empresas_usuarias', entidad_id: e.id })
      toast.success('Empresa eliminada.')
    } catch {
      toast.error('No se pudo eliminar.')
    }
  }

  const editando = creando || editId !== null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-body text-sm text-gray-500">{empresas.length} empresas usuarias</p>
        {!editando && (
          <button onClick={abrirNuevo} className="flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2 rounded-xl transition-colors">
            <Plus className="w-4 h-4" /> Nueva empresa
          </button>
        )}
      </div>

      {/* Form inline */}
      {editando && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm text-gray-800">{editId ? 'Editar empresa' : 'Nueva empresa usuaria'}</h3>
            <button onClick={cerrar} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className={inputCls} placeholder="Nombre *" />
            <input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} className={inputCls} placeholder="NIT" />
            <input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} className={inputCls} placeholder="Ciudad" />
            <input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} className={inputCls} placeholder="Contacto" />
            <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className={inputCls} placeholder="Teléfono" />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} placeholder="Email" />
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={guardar} disabled={saving} className="flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-5 py-2 rounded-lg transition-colors disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="grid gap-2 sm:grid-cols-2">
        {empresas.length === 0 && !editando && (
          <div className="col-span-full py-12 text-center">
            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="font-body text-sm text-gray-400">Aún no hay empresas usuarias.</p>
          </div>
        )}
        {empresas.map((e) => (
          <div key={e.id} className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green/10 shrink-0">
              <Building2 className="w-4 h-4 text-brand-green" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-body font-medium text-sm text-gray-900 truncate">{e.nombre}</p>
              <p className="font-body text-xs text-gray-400 truncate">
                {[e.nit, e.ciudad].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
              </p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => abrirEdit(e)} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => eliminar(e)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
