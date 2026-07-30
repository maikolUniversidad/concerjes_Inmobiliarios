'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, ToggleLeft, ToggleRight, X, Save, Loader2 } from 'lucide-react'
import { upsertTipoServicio, toggleTipoServicioActivo } from '../actions'

const ICONOS = ['🧹', '✨', '🏗️', '🎉', '🍳', '🌿', '🚗', '🏠', '🛁', '👶']
const COLORES = ['green', 'blue', 'orange', 'purple', 'amber', 'emerald', 'red', 'pink']

interface Tipo {
  id?: string; nombre: string; descripcion: string; icono: string
  color: string; incluye: string[]; activo: boolean; orden: number
}

const VACIO: Tipo = { nombre: '', descripcion: '', icono: '🧹', color: 'green', incluye: [], activo: true, orden: 0 }

export default function TiposClient({ tipos }: { tipos: any[] }) {
  const router = useRouter()
  const [modal, setModal] = useState<Tipo | null>(null)
  const [nuevoItem, setNuevoItem] = useState('')
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  function abrir(tipo?: any) {
    setModal(tipo ? { ...tipo, incluye: tipo.incluye ?? [] } : { ...VACIO })
  }

  function cerrar() { setModal(null); setNuevoItem('') }

  function agregarItem() {
    if (!nuevoItem.trim() || !modal) return
    setModal({ ...modal, incluye: [...modal.incluye, nuevoItem.trim()] })
    setNuevoItem('')
  }

  function quitarItem(i: number) {
    if (!modal) return
    setModal({ ...modal, incluye: modal.incluye.filter((_, j) => j !== i) })
  }

  async function guardar() {
    if (!modal) return
    setSaving(true)
    try {
      await upsertTipoServicio(modal)
      cerrar()
      startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  async function toggle(id: string, activo: boolean) {
    await toggleTipoServicioActivo(id, !activo)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => abrir()}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Nuevo tipo
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tipos.map((t: any) => (
          <div key={t.id} className={`bg-white border rounded-2xl overflow-hidden transition-opacity ${!t.activo ? 'opacity-60' : ''}`}>
            <div className={`bg-gradient-to-r from-${t.color}-500 to-${t.color}-600 p-4 flex items-center gap-3`}>
              <span className="text-3xl">{t.icono}</span>
              <div className="flex-1">
                <p className="font-bold text-white">{t.nombre}</p>
                <p className="text-white/70 text-xs mt-0.5 line-clamp-2">{t.descripcion}</p>
              </div>
            </div>
            <div className="p-4">
              {t.incluye?.length > 0 && (
                <ul className="space-y-1 mb-3">
                  {t.incluye.map((item: string) => (
                    <li key={item} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-green inline-block shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => abrir(t)}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 rounded-xl py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Editar
                </button>
                <button onClick={() => toggle(t.id, t.activo)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                    t.activo ? 'border-green-200 text-green-600 hover:bg-green-50' : 'border-red-200 text-red-600 hover:bg-red-50'
                  }`}>
                  {t.activo ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  {t.activo ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={cerrar}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">{modal.id ? 'Editar tipo' : 'Nuevo tipo de servicio'}</h3>
              <button onClick={cerrar}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Ícono</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICONOS.map(ic => (
                      <button key={ic} onClick={() => setModal({ ...modal, icono: ic })}
                        className={`w-9 h-9 rounded-lg text-xl flex items-center justify-center border-2 transition-colors ${modal.icono === ic ? 'border-brand-green bg-green-50' : 'border-gray-200'}`}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Color</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORES.map(c => (
                      <button key={c} onClick={() => setModal({ ...modal, color: c })}
                        className={`w-7 h-7 rounded-lg bg-${c}-500 border-2 transition-colors ${modal.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`} />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Nombre *</label>
                <input value={modal.nombre} onChange={e => setModal({ ...modal, nombre: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Descripción</label>
                <textarea value={modal.descripcion} onChange={e => setModal({ ...modal, descripcion: e.target.value })}
                  rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none resize-none focus:border-brand-green" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Qué incluye</label>
                {modal.incluye.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <span className="flex-1 text-sm text-gray-700 bg-gray-50 rounded-lg px-2.5 py-1.5">{it}</span>
                    <button onClick={() => quitarItem(i)}><X className="w-4 h-4 text-red-400" /></button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input value={nuevoItem} onChange={e => setNuevoItem(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && agregarItem()}
                    placeholder="Ej: Limpieza de baños"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-brand-green" />
                  <button onClick={agregarItem}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm transition-colors">
                    <Plus className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Orden</label>
                  <input type="number" value={modal.orden} onChange={e => setModal({ ...modal, orden: parseInt(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={cerrar} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button onClick={guardar} disabled={saving || !modal.nombre}
                className="flex-1 bg-brand-green text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-brand-green-dark disabled:opacity-60 transition-colors">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
