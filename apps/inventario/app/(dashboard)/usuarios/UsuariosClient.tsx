'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2,
  UserPlus,
  Users,
  X,
  ChevronRight,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Shield,
  Check,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { GRUPOS_PERMISOS, countActivos, colorRol } from '@/lib/permisos'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Rol asignable, proveniente de la tabla `roles` (dinámico). */
export interface RolOption {
  id: string
  nombre: string
  descripcion: string | null
  permisos: Record<string, boolean> | null
  rol_base: string | null
  activo: boolean
}

export interface GrupoOption {
  id: string
  codigo: string
  nombre: string
}

export interface SedeOption {
  id: string
  grupo_id: string
  nombre: string
}

export interface Usuario {
  id: string
  nombre: string
  email: string
  rol: string
  rol_id: string | null
  grupo_id: string | null
  sede_id: string | null
  activo: boolean
  ultimo_acceso: string | null
  created_at: string
  avatar_url: string | null
  telefono: string | null
  permisos: Record<string, boolean> | null
  grupos_contrato: { id: string; codigo: string; nombre: string } | null
  roles: { id: string; nombre: string; permisos: Record<string, boolean> | null } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Nombre legible del rol de un usuario (dinámico, con fallback al enum). */
function nombreRol(u: Usuario, roles: RolOption[]): string {
  return u.roles?.nombre ?? roles.find((r) => r.id === u.rol_id)?.nombre ?? u.rol ?? '—'
}

function initials(nombre: string) {
  return nombre
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function Avatar({
  url,
  nombre,
  size = 'md',
}: {
  url: string | null
  nombre: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-base' : 'w-9 h-9 text-xs'
  if (url) {
    return (
      <img
        src={url}
        alt={nombre}
        className={`${dim} rounded-full object-cover shrink-0`}
      />
    )
  }
  return (
    <div
      className={`${dim} rounded-full bg-[#2E7D32] flex items-center justify-center text-white font-heading font-bold shrink-0`}
    >
      {initials(nombre)}
    </div>
  )
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-[#2E7D32] bg-white transition-colors'

// ─── Drawer Form ──────────────────────────────────────────────────────────────

interface DrawerFormProps {
  usuario: Usuario | null
  grupos: GrupoOption[]
  sedes: SedeOption[]
  roles: RolOption[]
  onClose: () => void
  onSaved: (updated: Usuario) => void
  onDeleted: (id: string) => void
}

const USER_SELECT = `id, nombre, email, rol, rol_id, grupo_id, sede_id, activo, ultimo_acceso, created_at, avatar_url, telefono, permisos, grupos_contrato(id, codigo, nombre), roles(id, nombre, permisos)`

function DrawerForm({ usuario, grupos, sedes, roles, onClose, onSaved, onDeleted }: DrawerFormProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as any
  const isNew = usuario === null

  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [email, setEmail] = useState(usuario?.email ?? '')
  const [password, setPassword] = useState('')
  const [telefono, setTelefono] = useState(usuario?.telefono ?? '')
  const [rolId, setRolId] = useState<string>(usuario?.rol_id ?? roles[0]?.id ?? '')
  const [grupoId, setGrupoId] = useState(usuario?.grupo_id ?? '')
  const [sedeId, setSedeId] = useState(usuario?.sede_id ?? '')
  const [activo, setActivo] = useState(usuario?.activo ?? true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(usuario?.avatar_url ?? null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(usuario?.avatar_url ?? null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filteredSedes = grupoId
    ? sedes.filter((s) => s.grupo_id === grupoId)
    : sedes

  const rolSel = roles.find((r) => r.id === rolId) ?? null

  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setAvatarPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function uploadAvatar(userId: string): Promise<string | null> {
    if (!avatarFile) return avatarUrl
    const ext = avatarFile.name.split('.').pop() ?? 'jpg'
    const path = `${Date.now()}_${userId}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatares')
      .upload(path, avatarFile, { upsert: true })
    if (uploadError) {
      console.error('Avatar upload error', uploadError)
      return avatarUrl
    }
    const { data } = supabase.storage.from('avatares').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleSave() {
    if (!nombre.trim() || !email.trim()) {
      setError('Nombre y email son obligatorios.')
      return
    }
    if (isNew && !password.trim()) {
      setError('La contraseña es obligatoria para nuevos usuarios.')
      return
    }
    if (password && password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        // Llama a la API route que usa service role para crear el auth user
        const res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: nombre.trim(),
            email: email.trim(),
            password,
            telefono: telefono.trim() || null,
            rol_id: rolId || null,
            grupo_id: grupoId || null,
            sede_id: sedeId || null,
            activo,
          }),
        })
        const json = await res.json()
        if (!res.ok || !json.usuario) {
          setError(json.error ?? 'Error al crear usuario.')
          return
        }
        const inserted = json.usuario

        const newAvatarUrl = await uploadAvatar(inserted.id)
        if (newAvatarUrl) {
          await fetch('/api/usuarios', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: inserted.id, avatar_url: newAvatarUrl }),
          })
          inserted.avatar_url = newAvatarUrl
        }

        await logActivity(supabase, {
          accion: 'CREAR',
          modulo: 'Usuarios',
          descripcion: `Usuario creado: ${inserted.nombre}`,
          entidad: 'usuarios',
          entidad_id: inserted.id,
          detalle: { rol: rolSel?.nombre ?? null, email },
        })

        onSaved(inserted as unknown as Usuario)
      } else {
        const newAvatarUrl = await uploadAvatar(usuario!.id)

        // Si hay contraseña nueva, actualizarla via API route (service role)
        if (password.trim()) {
          const res = await fetch('/api/usuarios', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: usuario!.id, password }),
          })
          if (!res.ok) {
            const j = await res.json()
            setError(j.error ?? 'Error al cambiar contraseña.')
            return
          }
        }

        const { data: updated, error: updateErr } = await supabase
          .from('usuarios')
          .update({
            nombre: nombre.trim(),
            telefono: telefono.trim() || null,
            rol_id: rolId || null,
            grupo_id: grupoId || null,
            sede_id: sedeId || null,
            activo,
            avatar_url: newAvatarUrl,
          })
          .eq('id', usuario!.id)
          .select(USER_SELECT)
          .single()

        if (updateErr || !updated) {
          setError(updateErr?.message ?? 'Error al actualizar usuario.')
          return
        }

        await logActivity(supabase, {
          accion: 'EDITAR',
          modulo: 'Usuarios',
          descripcion: `Usuario editado: ${updated.nombre}`,
          entidad: 'usuarios',
          entidad_id: updated.id,
          detalle: { rol: rolSel?.nombre ?? null, activo },
        })

        onSaved(updated as unknown as Usuario)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!usuario) return
    if (!window.confirm(`¿Desactivar al usuario ${usuario.nombre}? Esta acción puede revertirse.`)) return
    setSaving(true)
    try {
      await supabase.from('usuarios').update({ activo: false }).eq('id', usuario.id)
      await logActivity(supabase, {
        accion: 'DESACTIVAR',
        modulo: 'Usuarios',
        descripcion: `Usuario desactivado: ${usuario.nombre}`,
        entidad: 'usuarios',
        entidad_id: usuario.id,
      })
      onDeleted(usuario.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
        <h2 className="font-heading font-bold text-base text-gray-900">
          {isNew ? 'Nuevo usuario' : 'Editar usuario'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Avatar upload */}
        <div className="flex flex-col items-center gap-3">
          <div
            className={`relative w-20 h-20 rounded-full border-2 border-dashed transition-colors cursor-pointer ${
              dragOver ? 'border-[#2E7D32] bg-green-50' : 'border-gray-300 hover:border-[#2E7D32]'
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFile(f)
            }}
          >
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="preview"
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-[#2E7D32] flex items-center justify-center text-white font-heading font-bold text-lg">
                {nombre ? initials(nombre) : <Upload className="w-6 h-6 opacity-60" />}
              </div>
            )}
            <div className="absolute bottom-0 right-0 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm">
              <Upload className="w-3 h-3 text-gray-500" />
            </div>
          </div>
          <p className="font-body text-xs text-gray-400">Click o arrastra para cambiar foto</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-red-700 font-body text-sm">
            {error}
          </div>
        )}

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputCls}
              placeholder="Nombre completo"
            />
          </div>

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="correo@ejemplo.com"
              disabled={!isNew}
            />
          </div>

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              {isNew ? <>Contraseña <span className="text-red-500">*</span></> : 'Nueva contraseña'}
              {!isNew && <span className="text-gray-400 font-normal ml-1">(dejar en blanco para no cambiar)</span>}
            </label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pr-10`}
                placeholder={isNew ? 'Mínimo 6 caracteres' : '••••••••'}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              Teléfono
            </label>
            <input
              type="text"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className={inputCls}
              placeholder="+57 300 000 0000"
            />
          </div>

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              Rol
            </label>
            <select
              value={rolId}
              onChange={(e) => setRolId(e.target.value)}
              className={inputCls}
            >
              {roles.length === 0 && <option value="">— Sin roles definidos —</option>}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
            {rolSel?.descripcion && (
              <p className="font-body text-xs text-gray-400 mt-1">{rolSel.descripcion}</p>
            )}
          </div>

          {/* Preview de permisos del rol seleccionado (solo lectura) */}
          {rolSel && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 font-body font-semibold text-xs text-gray-600">
                  <Shield className="w-3.5 h-3.5 text-[#2E7D32]" /> Permisos de este rol
                </span>
                <span className="font-body text-xs text-gray-400">
                  {countActivos(rolSel.permisos)} activos
                </span>
              </div>
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {GRUPOS_PERMISOS.map((g) => {
                  const activos = g.permisos.filter((p) => rolSel.permisos?.[p.key])
                  if (activos.length === 0) return null
                  return (
                    <div key={g.grupo}>
                      <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.grupo}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {activos.map((p) => (
                          <span key={p.key} className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2 py-0.5 font-body text-[11px] text-gray-600">
                            <Check className="w-2.5 h-2.5 text-[#2E7D32]" /> {p.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {countActivos(rolSel.permisos) === 0 && (
                  <p className="font-body text-xs text-gray-400">Este rol no tiene permisos asignados.</p>
                )}
              </div>
              <p className="mt-2 font-body text-[11px] text-gray-400">
                Edita los permisos desde <span className="font-semibold">Roles y Permisos</span>.
              </p>
            </div>
          )}

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              Grupo de contrato
            </label>
            <select
              value={grupoId}
              onChange={(e) => { setGrupoId(e.target.value); setSedeId('') }}
              className={inputCls}
            >
              <option value="">— Ninguno —</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.codigo} · {g.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">
              Sede asignada
            </label>
            <select
              value={sedeId}
              onChange={(e) => setSedeId(e.target.value)}
              className={inputCls}
            >
              <option value="">— Ninguna —</option>
              {filteredSedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Activo toggle */}
          <div className="flex items-center justify-between py-1">
            <span className="font-body text-sm text-gray-700">Usuario activo</span>
            <button
              type="button"
              onClick={() => setActivo((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                activo ? 'bg-[#2E7D32]' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  activo ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-5 py-4 border-t border-gray-100 space-y-2 shrink-0">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {isNew ? 'Crear usuario' : 'Guardar cambios'}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
            Desactivar usuario
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Client Component ────────────────────────────────────────────────────

interface UsuariosClientProps {
  usuarios: Usuario[]
  grupos: GrupoOption[]
  sedes: SedeOption[]
  roles: RolOption[]
}

export default function UsuariosClient({ usuarios: initialUsuarios, grupos, sedes, roles }: UsuariosClientProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as any
  const [usuarios, setUsuarios] = useState<Usuario[]>(initialUsuarios)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Usuario | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  function openNew() {
    setSelected(null)
    setDrawerOpen(true)
  }

  function openEdit(u: Usuario) {
    setSelected(u)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setSelected(null)
  }

  function handleSaved(updated: Usuario) {
    setUsuarios((prev) => {
      const idx = prev.findIndex((u) => u.id === updated.id)
      if (idx === -1) return [updated, ...prev]
      const next = [...prev]
      next[idx] = updated
      return next
    })
    closeDrawer()
  }

  function handleDeleted(id: string) {
    setUsuarios((prev) =>
      prev.map((u) => (u.id === id ? { ...u, activo: false } : u))
    )
    closeDrawer()
  }

  async function toggleActivo(u: Usuario, e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingId(u.id)
    const newActivo = !u.activo
    try {
      await supabase.from('usuarios').update({ activo: newActivo }).eq('id', u.id)
      await logActivity(supabase, {
        accion: newActivo ? 'ACTIVAR' : 'DESACTIVAR',
        modulo: 'Usuarios',
        descripcion: `Usuario ${newActivo ? 'activado' : 'desactivado'}: ${u.nombre}`,
        entidad: 'usuarios',
        entidad_id: u.id,
      })
      setUsuarios((prev) =>
        prev.map((usr) => (usr.id === u.id ? { ...usr, activo: newActivo } : usr))
      )
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <>
      {/* Header row */}
      <div className="flex items-center justify-end">
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Nuevo usuario
        </button>
      </div>

      {/* Table card */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                  Usuario
                </th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                  Rol
                </th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">
                  Grupo
                </th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 hidden lg:table-cell">
                  Creado
                </th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                  Activo
                </th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {usuarios.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="font-body text-sm text-gray-400">No hay usuarios registrados</p>
                  </td>
                </tr>
              )}
              {usuarios.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => openEdit(u)}
                  className="cursor-pointer hover:bg-gray-50/60 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar url={u.avatar_url} nombre={u.nombre} size="sm" />
                      <div>
                        <p className="font-body font-medium text-sm text-gray-900 leading-tight">
                          {u.nombre}
                        </p>
                        <p className="font-body text-xs text-gray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const nombre = nombreRol(u, roles)
                      return (
                        <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${colorRol(nombre)}`}>
                          {nombre}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="font-body text-sm text-gray-600">
                      {u.grupos_contrato
                        ? `${u.grupos_contrato.codigo} · ${u.grupos_contrato.nombre}`
                        : <span className="text-gray-300">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="font-body text-xs text-gray-400">
                      {formatFecha(u.created_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {togglingId === u.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto" />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => toggleActivo(u, e)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          u.activo ? 'bg-[#2E7D32]' : 'bg-gray-200'
                        }`}
                        title={u.activo ? 'Desactivar' : 'Activar'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            u.activo ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right-side drawer */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeDrawer}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {drawerOpen && (
          <DrawerForm
            usuario={selected}
            grupos={grupos}
            sedes={sedes}
            roles={roles}
            onClose={closeDrawer}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        )}
      </div>
    </>
  )
}
