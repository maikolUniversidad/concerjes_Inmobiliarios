'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Building2, Plus, X, Loader2, Trash2, Star, Upload, Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

export interface EmpresaRow {
  id: string
  razon_social: string
  nombre_comercial: string | null
  nit: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  sitio_web: string | null
  logo_path: string | null
  es_predeterminada: boolean
  activo: boolean
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'
const labelCls = 'font-body font-semibold text-xs text-gray-600 block mb-1'

const SELECT = 'id, razon_social, nombre_comercial, nit, telefono, email, direccion, ciudad, sitio_web, logo_path, es_predeterminada, activo'

function DrawerForm({ empresa, publicUrl, onClose, onSaved, onDeleted, sb }: {
  empresa: EmpresaRow | null
  publicUrl: (p: string | null) => string | null
  onClose: () => void
  onSaved: (e: EmpresaRow) => void
  onDeleted: (id: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
}) {
  const isNew = empresa === null
  const [f, setF] = useState({
    razon_social: empresa?.razon_social ?? '',
    nombre_comercial: empresa?.nombre_comercial ?? '',
    nit: empresa?.nit ?? '',
    telefono: empresa?.telefono ?? '',
    email: empresa?.email ?? '',
    direccion: empresa?.direccion ?? '',
    ciudad: empresa?.ciudad ?? '',
    sitio_web: empresa?.sitio_web ?? '',
  })
  const [predet, setPredet] = useState(empresa?.es_predeterminada ?? false)
  const [logoPath, setLogoPath] = useState<string | null>(empresa?.logo_path ?? null)
  const [logoPreview, setLogoPreview] = useState<string | null>(empresa ? publicUrl(empresa.logo_path) : null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  function pickLogo(file: File) {
    if (!file.type.startsWith('image/')) return
    setLogoFile(file)
    const r = new FileReader()
    r.onload = (e) => setLogoPreview(e.target?.result as string)
    r.readAsDataURL(file)
  }

  async function subirLogo(): Promise<string | null> {
    if (!logoFile) return logoPath
    const ext = logoFile.name.split('.').pop() ?? 'png'
    const path = `logos/${Date.now()}.${ext}`
    const { error: up } = await sb.storage.from('empresas').upload(path, logoFile, { upsert: true, contentType: logoFile.type })
    if (up) { toast.error('No se pudo subir el logo.'); return logoPath }
    return path
  }

  async function guardar() {
    if (!f.razon_social.trim()) { setError('La razón social es obligatoria.'); return }
    setSaving(true); setError(null)
    try {
      const newLogo = await subirLogo()
      const payload = {
        razon_social: f.razon_social.trim(),
        nombre_comercial: f.nombre_comercial.trim() || null,
        nit: f.nit.trim() || null,
        telefono: f.telefono.trim() || null,
        email: f.email.trim() || null,
        direccion: f.direccion.trim() || null,
        ciudad: f.ciudad.trim() || null,
        sitio_web: f.sitio_web.trim() || null,
        logo_path: newLogo,
      }

      // Si esta será la predeterminada, primero desmarca las demás.
      if (predet) await sb.from('empresas_emisoras').update({ es_predeterminada: false }).neq('id', empresa?.id ?? '00000000-0000-0000-0000-000000000000')

      let row: EmpresaRow | null = null
      if (isNew) {
        const { data, error: err } = await sb.from('empresas_emisoras').insert({ ...payload, es_predeterminada: predet, activo: true }).select(SELECT).single()
        if (err || !data) { setError(err?.message?.includes('row-level security') ? 'Requiere rol Administrador.' : (err?.message ?? 'Error al crear.')); return }
        row = data as EmpresaRow
      } else {
        const { data, error: err } = await sb.from('empresas_emisoras').update({ ...payload, es_predeterminada: predet }).eq('id', empresa!.id).select(SELECT).single()
        if (err || !data) { setError(err?.message ?? 'Error al actualizar.'); return }
        row = data as EmpresaRow
      }
      setLogoPath(newLogo)
      onSaved(row)
      toast.success(isNew ? 'Empresa creada.' : 'Cambios guardados.')
    } finally {
      setSaving(false)
    }
  }

  async function eliminar() {
    if (!empresa) return
    if (!window.confirm(`¿Eliminar "${empresa.razon_social}"?`)) return
    setSaving(true)
    try {
      const { error: err } = await sb.from('empresas_emisoras').delete().eq('id', empresa.id)
      if (err) { toast.error('No se pudo eliminar.'); return }
      onDeleted(empresa.id)
      toast.success('Empresa eliminada.')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
        <h2 className="font-heading font-bold text-base text-gray-900 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-green" /> {isNew ? 'Nueva empresa' : 'Editar empresa'}
        </h2>
        <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {error && <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 font-body text-sm text-red-700">{error}</div>}

        {/* Logo */}
        <div className="flex items-center gap-4">
          <div onClick={() => fileRef.current?.click()}
            className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 hover:border-brand-green flex items-center justify-center cursor-pointer bg-gray-50 overflow-hidden shrink-0">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="logo" className="w-full h-full object-contain" />
            ) : <Upload className="w-6 h-6 text-gray-300" />}
          </div>
          <div>
            <p className="font-body text-sm font-medium text-gray-700">Logo de la empresa</p>
            <p className="font-body text-xs text-gray-400">Se usa en los documentos. PNG/JPG.</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) pickLogo(x) }} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Razón social <span className="text-red-500">*</span></label>
          <input value={f.razon_social} onChange={(e) => set('razon_social', e.target.value)} className={inputCls} placeholder="CONSERJES INMOBILIARIOS LTDA" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Nombre comercial</label><input value={f.nombre_comercial} onChange={(e) => set('nombre_comercial', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>NIT</label><input value={f.nit} onChange={(e) => set('nit', e.target.value)} className={inputCls} placeholder="800093388-2" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Teléfono</label><input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Email</label><input value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} /></div>
        </div>
        <div><label className={labelCls}>Dirección</label><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} className={inputCls} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Ciudad</label><input value={f.ciudad} onChange={(e) => set('ciudad', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Sitio web</label><input value={f.sitio_web} onChange={(e) => set('sitio_web', e.target.value)} className={inputCls} /></div>
        </div>

        <label className="flex items-center gap-2 py-1 cursor-pointer">
          <button type="button" onClick={() => setPredet((v) => !v)}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${predet ? 'bg-brand-green border-brand-green' : 'border-gray-300 bg-white'}`}>
            {predet && <Check className="w-3 h-3 text-white" />}
          </button>
          <span className="font-body text-sm text-gray-700 flex items-center gap-1"><Star className="w-3.5 h-3.5 text-amber-500" /> Usar como empresa predeterminada en documentos</span>
        </label>
      </div>

      <div className="border-t border-gray-100 px-5 py-4 space-y-2 shrink-0">
        <button onClick={guardar} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} {isNew ? 'Crear empresa' : 'Guardar cambios'}
        </button>
        {!isNew && (
          <button onClick={eliminar} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors">
            <Trash2 className="w-4 h-4" /> Eliminar empresa
          </button>
        )}
      </div>
    </div>
  )
}

export function EmpresasClient({ empresas: init, puedeEditar }: { empresas: EmpresaRow[]; puedeEditar: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [empresas, setEmpresas] = useState<EmpresaRow[]>(init)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<EmpresaRow | null>(null)

  const publicUrl = useMemo(() => (p: string | null) => {
    if (!p) return null
    return sb.storage.from('empresas').getPublicUrl(p).data.publicUrl as string
  }, [sb])

  function onSaved(row: EmpresaRow) {
    setEmpresas((prev) => {
      const next = row.es_predeterminada ? prev.map((e) => ({ ...e, es_predeterminada: false })) : [...prev]
      const i = next.findIndex((e) => e.id === row.id)
      if (i === -1) return [row, ...next]
      next[i] = row
      return next
    })
    setOpen(false); setSel(null)
  }
  function onDeleted(id: string) { setEmpresas((p) => p.filter((e) => e.id !== id)); setOpen(false); setSel(null) }

  return (
    <>
      <Link href="/configuracion" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="w-4 h-4" /> Volver a Configuración
      </Link>

      <div className="flex justify-end">
        {puedeEditar && (
          <button onClick={() => { setSel(null); setOpen(true) }}
            className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors">
            <Plus className="w-4 h-4" /> Nueva empresa
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {empresas.length === 0 && (
          <div className="sm:col-span-2 bg-white border border-gray-100 rounded-2xl p-14 text-center shadow-sm">
            <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="font-body text-sm text-gray-400">No hay empresas registradas.</p>
          </div>
        )}
        {empresas.map((e) => {
          const url = publicUrl(e.logo_path)
          return (
            <button key={e.id} onClick={() => puedeEditar && (setSel(e), setOpen(true))}
              className="text-left bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-brand-green/40 hover:shadow transition-all flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={e.razon_social} className="w-full h-full object-contain" />
                ) : <Building2 className="w-6 h-6 text-gray-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-heading font-bold text-sm text-gray-900 truncate">{e.razon_social}</p>
                  {e.es_predeterminada && <span className="shrink-0 inline-flex items-center gap-0.5 font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"><Star className="w-2.5 h-2.5" /> Predet.</span>}
                </div>
                <p className="font-body text-xs text-gray-500 truncate">{e.nit ? `NIT ${e.nit}` : 'Sin NIT'}{e.telefono ? ` · ${e.telefono}` : ''}</p>
                <p className="font-body text-xs text-gray-400 truncate">{e.ciudad ?? ''}{e.sitio_web ? ` · ${e.sitio_web}` : ''}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={() => { setOpen(false); setSel(null) }} />
      <div className={`fixed top-0 right-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {open && <DrawerForm empresa={sel} publicUrl={publicUrl} sb={sb} onClose={() => { setOpen(false); setSel(null) }} onSaved={onSaved} onDeleted={onDeleted} />}
      </div>
    </>
  )
}
