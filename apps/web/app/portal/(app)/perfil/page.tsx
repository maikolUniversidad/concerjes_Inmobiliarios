'use client'

import { useEffect, useState } from 'react'
import {
  Loader2, User, Phone, IdCard, Mail, Save, MapPin, Plus, Trash2, Star, Home, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getPortalSupabase } from '@/lib/supabase/portal'
import { usePortal } from '../_portal/PortalProvider'

interface Direccion {
  id: string; etiqueta: string; direccion: string; ciudad: string; barrio: string | null
  notas: string | null; es_principal: boolean
}

export default function PerfilPage() {
  const { cliente, session, refrescarCliente } = usePortal()
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [documento, setDocumento] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [dirs, setDirs] = useState<Direccion[]>([])
  const [cargandoDirs, setCargandoDirs] = useState(true)
  const [nueva, setNueva] = useState(false)

  useEffect(() => {
    if (cliente) {
      setNombre(cliente.nombre === 'Cliente' ? '' : cliente.nombre)
      setTelefono(cliente.telefono ?? '')
      setDocumento(cliente.documento ?? '')
    }
  }, [cliente])

  async function cargarDirs() {
    const sb = getPortalSupabase()
    const { data } = await sb.from('direcciones_cliente').select('*').eq('cliente_id', session.user.id).order('es_principal', { ascending: false })
    setDirs((data as Direccion[]) ?? [])
    setCargandoDirs(false)
  }
  useEffect(() => { cargarDirs() }, [session.user.id])

  async function guardarPerfil() {
    if (!nombre.trim()) { toast.error('Escribe tu nombre.'); return }
    setGuardando(true)
    const sb = getPortalSupabase()
    const { error } = await sb.from('clientes')
      .update({ nombre: nombre.trim(), telefono: telefono.trim() || null, documento: documento.trim() || null })
      .eq('id', session.user.id)
    setGuardando(false)
    if (error) { toast.error('No se pudo guardar.'); return }
    toast.success('Perfil actualizado.')
    refrescarCliente()
  }

  async function eliminarDir(id: string) {
    const sb = getPortalSupabase()
    const { error } = await sb.from('direcciones_cliente').delete().eq('id', id)
    if (error) { toast.error('No se pudo eliminar.'); return }
    cargarDirs()
  }

  async function marcarPrincipal(id: string) {
    const sb = getPortalSupabase()
    await sb.from('direcciones_cliente').update({ es_principal: false }).eq('cliente_id', session.user.id)
    await sb.from('direcciones_cliente').update({ es_principal: true }).eq('id', id)
    cargarDirs()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="font-heading text-2xl font-bold text-gray-900">Mi perfil</h1>

      {/* Datos personales */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-3">
          {cliente?.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cliente.foto_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
              <User className="h-7 w-7" />
            </div>
          )}
          <div>
            <p className="font-heading font-bold text-gray-900">{nombre || 'Cliente'}</p>
            <p className="flex items-center gap-1 text-sm text-gray-400"><Mail className="h-3.5 w-3.5" /> {cliente?.email ?? 'Sin correo'}</p>
          </div>
        </div>

        <div className="space-y-4">
          <Campo icon={<User className="h-4 w-4" />} label="Nombre completo">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" className="w-full bg-transparent outline-none" />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo icon={<Phone className="h-4 w-4" />} label="Teléfono / WhatsApp">
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="310 000 0000" className="w-full bg-transparent outline-none" />
            </Campo>
            <Campo icon={<IdCard className="h-4 w-4" />} label="Documento (opcional)">
              <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="C.C." className="w-full bg-transparent outline-none" />
            </Campo>
          </div>
        </div>

        <button onClick={guardarPerfil} disabled={guardando}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar cambios
        </button>
      </section>

      {/* Direcciones */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-gray-900">Mis direcciones</h2>
          {!nueva && (
            <button onClick={() => setNueva(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-green px-3 py-1.5 text-sm font-semibold text-brand-green hover:bg-brand-green/5">
              <Plus className="h-4 w-4" /> Agregar
            </button>
          )}
        </div>

        {nueva && <FormDireccion clienteId={session.user.id} esPrimera={dirs.length === 0} onCerrar={() => setNueva(false)} onGuardado={() => { setNueva(false); cargarDirs() }} />}

        {cargandoDirs ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>
        ) : dirs.length === 0 && !nueva ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">Aún no has guardado direcciones.</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {dirs.map((d) => (
              <div key={d.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
                <Home className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-gray-900">
                    {d.etiqueta}
                    {d.es_principal && <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-semibold text-brand-green">Principal</span>}
                  </p>
                  <p className="text-sm text-gray-500">{d.direccion}{d.barrio ? `, ${d.barrio}` : ''} — {d.ciudad}</p>
                  {d.notas && <p className="mt-0.5 text-xs text-gray-400">{d.notas}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {!d.es_principal && (
                    <button onClick={() => marcarPrincipal(d.id)} title="Marcar principal" className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-amber-500">
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => eliminarDir(d.id)} title="Eliminar" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Campo({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-gray-600">{label}</label>
      <div className="flex items-center gap-2.5 rounded-xl border border-gray-300 px-3.5 py-3 focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/20">
        <span className="text-gray-400">{icon}</span>
        {children}
      </div>
    </div>
  )
}

function FormDireccion({ clienteId, esPrimera, onCerrar, onGuardado }: { clienteId: string; esPrimera: boolean; onCerrar: () => void; onGuardado: () => void }) {
  const [etiqueta, setEtiqueta] = useState('Casa')
  const [direccion, setDireccion] = useState('')
  const [ciudad, setCiudad] = useState('Bogotá')
  const [barrio, setBarrio] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (!direccion.trim()) { toast.error('Escribe la dirección.'); return }
    setGuardando(true)
    const sb = getPortalSupabase()
    const { error } = await sb.from('direcciones_cliente').insert({
      cliente_id: clienteId, etiqueta: etiqueta.trim() || 'Casa', direccion: direccion.trim(),
      ciudad: ciudad.trim() || 'Bogotá', barrio: barrio.trim() || null, notas: notas.trim() || null,
      es_principal: esPrimera,
    })
    setGuardando(false)
    if (error) { toast.error('No se pudo guardar.'); return }
    toast.success('Dirección guardada.')
    onGuardado()
  }

  return (
    <div className="mb-3 space-y-3 rounded-2xl border border-brand-green/30 bg-brand-green-bg/40 p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-gray-800">Nueva dirección</p>
        <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Etiqueta (Casa, Oficina…)" className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
        <input value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ciudad" className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
      </div>
      <div className="flex items-center gap-2.5 rounded-xl border border-gray-300 px-3.5 py-2.5 focus-within:border-brand-green">
        <MapPin className="h-4 w-4 text-gray-400" />
        <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle 72 # 10-03, Apto 501" className="w-full bg-transparent text-sm outline-none" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={barrio} onChange={(e) => setBarrio(e.target.value)} placeholder="Barrio" className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
        <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas (portería, torre…)" className="rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-green" />
      </div>
      <button onClick={guardar} disabled={guardando} className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar dirección
      </button>
    </div>
  )
}
