'use client'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Image from 'next/image'
import { Search, Plus, X, Loader2, Star, Building2, Phone, Mail, Pencil, Trash2 } from 'lucide-react'
import { crearProveedor, actualizarProveedor, eliminarProveedor, type ActionResult } from './actions'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { ImagePicker } from '@/components/ui/ImagePicker'

export interface ProveedorRow {
  id: string
  nombre: string
  nit: string | null
  contacto: string | null
  telefono: string | null
  email: string | null
  logo_url: string | null
  es_principal: boolean
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn({ editando }: { editando: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      {editando ? 'Guardar cambios' : 'Guardar proveedor'}
    </button>
  )
}

export function ProveedoresClient({ proveedores }: { proveedores: ProveedorRow[] }) {
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProveedorRow | null>(null)
  const action = editing ? actualizarProveedor : crearProveedor
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {})

  useEffect(() => { if (state.ok) { setShowForm(false); setEditing(null) } }, [state.ok])

  function abrirNuevo() { setEditing(null); setShowForm(true) }
  function abrirEditar(p: ProveedorRow) { setEditing(p); setShowForm(true) }

  const filtered = proveedores.filter(p =>
    !search || p.nombre.toLowerCase().includes(search.toLowerCase()) || (p.nit ?? '').includes(search))

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap gap-3 shadow-sm items-center">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o NIT..."
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400" />
        </div>
        <button onClick={() => (showForm ? setShowForm(false) : abrirNuevo())}
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cerrar' : 'Nuevo proveedor'}
        </button>
      </div>

      {showForm && (
        <form action={formAction} key={editing?.id ?? 'nuevo'} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <h3 className="font-heading font-semibold text-gray-900">{editing ? `Editar: ${editing.nombre}` : 'Nuevo proveedor'}</h3>
          {state.error && <p className="font-body text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{state.error}</p>}
          <ImagePicker name="logo_url" defaultUrl={editing?.logo_url ?? null} bucket="galeria-fotos" folder="proveedores" label="Logo del proveedor" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className="font-body font-semibold text-sm text-gray-700">Nombre *</label><input name="nombre" required defaultValue={editing?.nombre ?? ''} className={inputCls + ' mt-1'} /></div>
            <div><label className="font-body font-semibold text-sm text-gray-700">NIT</label><input name="nit" defaultValue={editing?.nit ?? ''} className={inputCls + ' mt-1'} /></div>
            <div><label className="font-body font-semibold text-sm text-gray-700">Contacto</label><input name="contacto" defaultValue={editing?.contacto ?? ''} className={inputCls + ' mt-1'} /></div>
            <div><label className="font-body font-semibold text-sm text-gray-700">Teléfono</label><input name="telefono" defaultValue={editing?.telefono ?? ''} className={inputCls + ' mt-1'} /></div>
            <div><label className="font-body font-semibold text-sm text-gray-700">Email</label><input name="email" type="email" defaultValue={editing?.email ?? ''} className={inputCls + ' mt-1'} /></div>
            <label className="flex items-center gap-2 mt-6 font-body text-sm text-gray-700">
              <input name="es_principal" type="checkbox" defaultChecked={editing?.es_principal ?? false} className="w-4 h-4 accent-brand-green" /> Proveedor principal
            </label>
          </div>
          <SubmitBtn editando={!!editing} />
        </form>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(p => (
          <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden relative shrink-0">
                {p.logo_url
                  ? <Image src={p.logo_url} alt={p.nombre} fill className="object-cover" sizes="40px" />
                  : <Building2 className="w-5 h-5 text-gray-500" />}
              </div>
              <div className="flex items-center gap-1">
                {p.es_principal && (
                  <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 font-body font-semibold text-xs px-2 py-0.5 rounded-full">
                    <Star className="w-3 h-3" /> Principal
                  </span>
                )}
                <button onClick={() => abrirEditar(p)} title="Editar"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 opacity-0 group-hover:opacity-100 transition-all">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <DeleteButton action={eliminarProveedor} id={p.id} mensaje={`¿Eliminar proveedor “${p.nombre}”?`}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </DeleteButton>
              </div>
            </div>
            <p className="font-heading font-bold text-base text-gray-900">{p.nombre}</p>
            {p.nit && <p className="font-body text-xs text-gray-400 mt-0.5">NIT {p.nit}</p>}
            <div className="mt-3 space-y-1">
              {p.contacto && <p className="font-body text-sm text-gray-600">{p.contacto}</p>}
              {p.telefono && <p className="flex items-center gap-1.5 font-body text-xs text-gray-500"><Phone className="w-3 h-3" /> {p.telefono}</p>}
              {p.email && <p className="flex items-center gap-1.5 font-body text-xs text-gray-500"><Mail className="w-3 h-3" /> {p.email}</p>}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="font-heading font-bold">Sin proveedores</p>
          <p className="font-body text-sm mt-1">Crea el primero con “Nuevo proveedor”.</p>
        </div>
      )}
    </div>
  )
}
