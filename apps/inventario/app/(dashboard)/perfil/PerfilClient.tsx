'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Camera, Loader2, Mail, Phone, Shield, Save, Lock, Building2,
  Calendar, User as UserIcon, Trash2, KeyRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { ROL_LABELS, type RolUsuario } from '@/lib/types/database'

interface Usuario {
  id: string
  nombre: string
  email: string
  rol: RolUsuario
  telefono: string
  avatar_url: string | null
  created_at: string | null
  ultimo_acceso: string | null
  grupo: string | null
  sede: string | null
}

function iniciales(nombre: string, email: string) {
  const base = nombre?.trim() || email
  return base.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase()
}

function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2.5 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors disabled:bg-gray-50 disabled:text-gray-400'

export function PerfilClient({ usuario }: { usuario: Usuario }) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const fileRef = useRef<HTMLInputElement>(null)

  const [nombre, setNombre] = useState(usuario.nombre)
  const [telefono, setTelefono] = useState(usuario.telefono)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(usuario.avatar_url)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const rol = ROL_LABELS[usuario.rol] ?? { label: usuario.rol, color: 'bg-gray-100 text-gray-700' }
  const dirty = nombre.trim() !== usuario.nombre || telefono.trim() !== (usuario.telefono ?? '') || avatarUrl !== usuario.avatar_url

  // ── Avatar ──────────────────────────────────────────────────────────────────
  async function subirAvatar(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Solo se permiten imágenes.'); return }
    if (file.size > 5 * 1024 * 1024) { toast.error('La imagen no puede superar 5 MB.'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
      const path = `${usuario.id}/${id}.${ext}`
      const { error } = await sb.storage.from('avatares').upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      const { data } = sb.storage.from('avatares').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
      toast.success('Foto cargada. No olvides guardar los cambios.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo subir la imagen.')
    } finally {
      setUploading(false)
    }
  }

  // ── Guardar datos personales ─────────────────────────────────────────────────
  async function guardar() {
    if (!nombre.trim()) { toast.error('El nombre es obligatorio.'); return }
    setSaving(true)
    try {
      const { error } = await sb.rpc('update_mi_perfil', {
        p_nombre: nombre.trim(),
        p_telefono: telefono.trim(),
        p_avatar_url: avatarUrl ?? '',
      })
      if (error) throw error
      await logActivity(sb, { accion: 'EDITAR', modulo: 'Perfil', descripcion: 'Actualizó su perfil' })
      toast.success('Perfil actualizado correctamente.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Tarjeta principal */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-sm">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="relative">
            <div className="h-24 w-24 overflow-hidden rounded-full bg-brand-green ring-4 ring-brand-green/10">
              {avatarUrl ? (
                <Image src={avatarUrl} alt={nombre} width={96} height={96} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-heading text-2xl font-bold text-white">{iniciales(nombre, usuario.email)}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-600 shadow hover:bg-gray-50 disabled:opacity-60"
              aria-label="Cambiar foto"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirAvatar(f); e.target.value = '' }}
            />
          </div>

          <div className="text-center sm:text-left">
            <h2 className="font-heading text-lg font-bold text-gray-900">{nombre || 'Sin nombre'}</h2>
            <p className="font-body text-sm text-gray-500">{usuario.email}</p>
            <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${rol.color}`}>
              <Shield className="h-3 w-3" /> {rol.label}
            </span>
          </div>

          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="sm:ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100"
            >
              <Trash2 className="h-3.5 w-3.5" /> Quitar foto
            </button>
          )}
        </div>

        {/* Datos editables */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block font-body text-xs font-semibold text-gray-600">
              <UserIcon className="mr-1 inline h-3.5 w-3.5" /> Nombre completo
            </label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="Tu nombre" />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs font-semibold text-gray-600">
              <Phone className="mr-1 inline h-3.5 w-3.5" /> Teléfono
            </label>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inputCls} placeholder="Ej. 320 808 1399" />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs font-semibold text-gray-600">
              <Mail className="mr-1 inline h-3.5 w-3.5" /> Correo electrónico
            </label>
            <input value={usuario.email} disabled className={inputCls} />
            <p className="mt-1 text-[11px] text-gray-400">El correo no se puede cambiar desde aquí.</p>
          </div>
          <div>
            <label className="mb-1 block font-body text-xs font-semibold text-gray-600">
              <Shield className="mr-1 inline h-3.5 w-3.5" /> Rol
            </label>
            <input value={rol.label} disabled className={inputCls} />
            <p className="mt-1 text-[11px] text-gray-400">Solo un administrador puede cambiar tu rol.</p>
          </div>
        </div>

        {/* Meta */}
        <div className="mt-5 grid gap-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-3">
          {usuario.grupo && (
            <div className="flex items-center gap-2 text-gray-500">
              <Building2 className="h-4 w-4 text-gray-400" /> Grupo: <span className="text-gray-700">{usuario.grupo}</span>
            </div>
          )}
          {usuario.sede && (
            <div className="flex items-center gap-2 text-gray-500">
              <Building2 className="h-4 w-4 text-gray-400" /> Sede: <span className="text-gray-700">{usuario.sede}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-500">
            <Calendar className="h-4 w-4 text-gray-400" /> Desde: <span className="text-gray-700">{fmtFecha(usuario.created_at)}</span>
          </div>
        </div>

        {/* Guardar */}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={guardar}
            disabled={saving || uploading || !dirty}
            className="flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 font-body font-semibold text-sm text-white hover:bg-brand-green-dark transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar cambios
          </button>
        </div>
      </div>

      {/* Seguridad: cambiar contraseña */}
      <CambiarPassword sb={sb} />
    </div>
  )
}

// ─── Cambio de contraseña ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CambiarPassword({ sb }: { sb: any }) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [saving, setSaving] = useState(false)

  async function cambiar() {
    if (pass.length < 8) { toast.error('La contraseña debe tener al menos 8 caracteres.'); return }
    if (pass !== pass2) { toast.error('Las contraseñas no coinciden.'); return }
    setSaving(true)
    try {
      const { error } = await sb.auth.updateUser({ password: pass })
      if (error) throw error
      await logActivity(sb, { accion: 'EDITAR', modulo: 'Perfil', descripcion: 'Cambió su contraseña' })
      toast.success('Contraseña actualizada.')
      setPass(''); setPass2('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Lock className="h-4 w-4 text-brand-green" />
        <h3 className="font-heading text-base font-bold text-gray-900">Seguridad</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block font-body text-xs font-semibold text-gray-600">Nueva contraseña</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className={inputCls} placeholder="Mínimo 8 caracteres" />
        </div>
        <div>
          <label className="mb-1 block font-body text-xs font-semibold text-gray-600">Confirmar contraseña</label>
          <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} className={inputCls} placeholder="Repite la contraseña" />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={cambiar}
          disabled={saving || !pass || !pass2}
          className="flex items-center gap-2 rounded-xl border border-brand-green px-5 py-2.5 font-body font-semibold text-sm text-brand-green hover:bg-green-50 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Actualizar contraseña
        </button>
      </div>
    </div>
  )
}
