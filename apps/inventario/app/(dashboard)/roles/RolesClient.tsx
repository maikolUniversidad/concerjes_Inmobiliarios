'use client'

import { useState, useMemo } from 'react'
import { Plus, X, Loader2, Shield, Trash2, ChevronRight, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { GRUPOS_PERMISOS, ALL_PERMISOS, emptyPermisos, countActivos } from '@/lib/permisos'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Rol {
  id: string
  nombre: string
  descripcion: string | null
  permisos: Record<string, boolean>
  activo: boolean
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-[#2E7D32] bg-white transition-colors'

// ─── Drawer Form ──────────────────────────────────────────────────────────────

interface DrawerFormProps {
  rol: Rol | null
  onClose: () => void
  onSaved: (r: Rol) => void
  onDeleted: (id: string) => void
}

function DrawerForm({ rol, onClose, onSaved, onDeleted }: DrawerFormProps) {
  const supabase = useMemo(() => createClient(), [])
  const isNew = rol === null

  const [nombre, setNombre] = useState(rol?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? '')
  const [permisos, setPermisos] = useState<Record<string, boolean>>(
    rol?.permisos ? { ...emptyPermisos(), ...rol.permisos } : emptyPermisos()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(key: string) {
    setPermisos((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleGrupo(grupo: typeof GRUPOS_PERMISOS[0]) {
    const allOn = grupo.permisos.every((p) => permisos[p.key])
    setPermisos((prev) => {
      const next = { ...prev }
      grupo.permisos.forEach((p) => { next[p.key] = !allOn })
      return next
    })
  }

  function toggleTodo() {
    const total = countActivos(permisos)
    const allOn = total === ALL_PERMISOS.length
    setPermisos(Object.fromEntries(ALL_PERMISOS.map((p) => [p.key, !allOn])))
  }

  async function handleSave() {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setSaving(true); setError(null)
    try {
      if (isNew) {
        const { data, error: err } = await (supabase as any)
          .from('roles')
          .insert({ nombre: nombre.trim(), descripcion: descripcion.trim() || null, permisos, activo: true })
          .select()
          .single()
        if (err || !data) { setError(err?.message ?? 'Error al crear rol.'); return }
        await logActivity(supabase as any, { accion: 'CREAR', modulo: 'Roles', descripcion: `Rol creado: ${data.nombre}`, entidad: 'roles', entidad_id: data.id })
        onSaved(data as Rol)
      } else {
        const { data, error: err } = await (supabase as any)
          .from('roles')
          .update({ nombre: nombre.trim(), descripcion: descripcion.trim() || null, permisos })
          .eq('id', rol!.id)
          .select()
          .single()
        if (err || !data) { setError(err?.message ?? 'Error al actualizar rol.'); return }
        await logActivity(supabase as any, { accion: 'EDITAR', modulo: 'Roles', descripcion: `Rol editado: ${data.nombre}`, entidad: 'roles', entidad_id: data.id })
        onSaved(data as Rol)
      }
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!rol) return
    if (!window.confirm(`¿Eliminar el rol "${rol.nombre}"? Los usuarios con este rol no se ven afectados.`)) return
    setSaving(true)
    try {
      await (supabase as any).from('roles').delete().eq('id', rol.id)
      await logActivity(supabase as any, { accion: 'ELIMINAR', modulo: 'Roles', descripcion: `Rol eliminado: ${rol.nombre}`, entidad: 'roles', entidad_id: rol.id })
      onDeleted(rol.id)
    } finally { setSaving(false) }
  }

  const totalActivos = countActivos(permisos)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#2E7D32]" />
          <h2 className="font-heading font-bold text-base text-gray-900">
            {isNew ? 'Nuevo rol' : 'Editar rol'}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-red-700 font-body text-sm">{error}</div>
        )}

        <div className="space-y-3">
          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Nombre del rol <span className="text-red-500">*</span></label>
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="Ej. Operador de Bodega" />
          </div>
          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Descripción</label>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="Qué puede hacer este rol..." />
          </div>
        </div>

        {/* Permisos */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-body font-semibold text-xs text-gray-600 uppercase tracking-wide">Permisos</p>
            <button type="button" onClick={toggleTodo} className="font-body text-xs text-[#2E7D32] hover:underline">
              {totalActivos === ALL_PERMISOS.length ? 'Quitar todos' : 'Seleccionar todos'}
            </button>
          </div>

          <div className="space-y-4">
            {GRUPOS_PERMISOS.map((grupo) => {
              const grupoActivos = grupo.permisos.filter((p) => permisos[p.key]).length
              const allOn = grupoActivos === grupo.permisos.length
              return (
                <div key={grupo.grupo} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleGrupo(grupo)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <span className="font-body font-semibold text-xs text-gray-700">{grupo.grupo}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-body text-xs text-gray-400">{grupoActivos}/{grupo.permisos.length}</span>
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${allOn ? 'border-[#2E7D32] bg-[#2E7D32]' : grupoActivos > 0 ? 'border-[#2E7D32] bg-white' : 'border-gray-300 bg-white'}`}>
                        {allOn && <Check className="w-2.5 h-2.5 text-white" />}
                        {!allOn && grupoActivos > 0 && <div className="w-2 h-0.5 bg-[#2E7D32]" />}
                      </div>
                    </div>
                  </button>
                  <div className="divide-y divide-gray-50">
                    {grupo.permisos.map((p) => (
                      <label key={p.key} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50/50 transition-colors">
                        <div
                          onClick={() => toggle(p.key)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${permisos[p.key] ? 'border-[#2E7D32] bg-[#2E7D32]' : 'border-gray-300 bg-white'}`}
                        >
                          {permisos[p.key] && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span className="font-body text-sm text-gray-700 select-none" onClick={() => toggle(p.key)}>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-gray-100 space-y-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="font-body text-xs text-gray-400">{totalActivos} de {ALL_PERMISOS.length} permisos activos</span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {isNew ? 'Crear rol' : 'Guardar cambios'}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Eliminar rol
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RolesClient({ roles: initialRoles, conteos = {} }: { roles: Rol[]; conteos?: Record<string, number> }) {
  const [roles, setRoles] = useState<Rol[]>(initialRoles)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Rol | null>(null)

  function openNew() { setSelected(null); setDrawerOpen(true) }
  function openEdit(r: Rol) { setSelected(r); setDrawerOpen(true) }
  function close() { setDrawerOpen(false); setSelected(null) }

  function handleSaved(r: Rol) {
    setRoles((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id)
      if (idx === -1) return [...prev, r]
      const next = [...prev]; next[idx] = r; return next
    })
    close()
  }

  function handleDeleted(id: string) {
    setRoles((prev) => prev.filter((r) => r.id !== id))
    close()
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-end">
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo rol
        </button>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {roles.length === 0 && (
          <div className="col-span-full py-20 text-center">
            <Shield className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="font-body text-sm text-gray-400">No hay roles creados aún</p>
          </div>
        )}
        {roles.map((r) => {
          const activos = countActivos(r.permisos ?? {})
          return (
            <button
              key={r.id}
              onClick={() => openEdit(r)}
              className="text-left bg-white border border-gray-100 rounded-2xl p-4 hover:border-[#2E7D32] hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-[#2E7D32]" />
                  </div>
                  <div>
                    <p className="font-heading font-bold text-sm text-gray-900 leading-tight">{r.nombre}</p>
                    <p className="font-body text-xs text-gray-400 mt-0.5">
                      {activos} permisos · {conteos[r.id] ?? 0} usuario{(conteos[r.id] ?? 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#2E7D32] mt-1 shrink-0 transition-colors" />
              </div>
              {r.descripcion && (
                <p className="font-body text-xs text-gray-500 mt-2 line-clamp-2">{r.descripcion}</p>
              )}
              {/* Mini preview de grupos */}
              <div className="mt-3 flex flex-wrap gap-1">
                {GRUPOS_PERMISOS.map((g) => {
                  const on = g.permisos.filter((p) => r.permisos?.[p.key]).length
                  if (on === 0) return null
                  return (
                    <span key={g.grupo} className="font-body text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {g.grupo} ({on})
                    </span>
                  )
                })}
              </div>
            </button>
          )
        })}
      </div>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-300 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={close}
      />
      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {drawerOpen && (
          <DrawerForm rol={selected} onClose={close} onSaved={handleSaved} onDeleted={handleDeleted} />
        )}
      </div>
    </>
  )
}
