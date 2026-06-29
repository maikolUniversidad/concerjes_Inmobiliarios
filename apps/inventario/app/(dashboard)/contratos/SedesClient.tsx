'use client'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, X, Loader2, Building2, MapPin, Pencil, Trash2 } from 'lucide-react'
import { crearSede, actualizarSede, eliminarSede, type ActionResult } from './actions'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { GRUPO_LABELS, type GrupoContrato } from '@/lib/types/database'

export interface GrupoOpt { id: string; codigo: GrupoContrato; nombre: string }
export interface SedeRow {
  id: string; nombre: string; zona: string | null; ciudad: string; codigo_interno: string | null
  grupo_id: string; grupo_codigo: GrupoContrato | null
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn({ editando }: { editando: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      {editando ? 'Guardar cambios' : 'Crear sede'}
    </button>
  )
}

export function SedesClient({ grupos, sedes }: { grupos: GrupoOpt[]; sedes: SedeRow[] }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<SedeRow | null>(null)
  const action = editing ? actualizarSede : crearSede
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {})

  useEffect(() => { if (state.ok) { setShowForm(false); setEditing(null) } }, [state.ok])

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Sedes / contratos cliente</h2>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(v => !v) }}
          className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-brand-green-dark">
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? 'Cerrar' : 'Nueva sede'}
        </button>
      </div>

      {showForm && (
        <form action={formAction} key={editing?.id ?? 'nueva'} className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-3">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {state.error && <p className="font-body text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{state.error}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Grupo de contrato *</label>
              <select name="grupo_id" required defaultValue={editing?.grupo_id ?? ''} className={inputCls + ' mt-1 bg-white'}>
                <option value="" disabled>— Selecciona —</option>
                {grupos.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">N° contrato</label>
              <input name="codigo_interno" defaultValue={editing?.codigo_interno ?? ''} className={inputCls + ' mt-1'} />
            </div>
            <div className="sm:col-span-2">
              <label className="font-body font-semibold text-xs text-gray-600">Nombre de la sede *</label>
              <input name="nombre" required defaultValue={editing?.nombre ?? ''} className={inputCls + ' mt-1'} />
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Zona</label>
              <input name="zona" defaultValue={editing?.zona ?? ''} className={inputCls + ' mt-1'} placeholder="Ej: ZONA 21" />
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Ciudad</label>
              <input name="ciudad" defaultValue={editing?.ciudad ?? 'BOGOTÁ D.C.'} className={inputCls + ' mt-1'} />
            </div>
          </div>
          <SubmitBtn editando={!!editing} />
        </form>
      )}

      {sedes.length === 0 ? (
        <div className="p-10 text-center text-gray-400">
          <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="font-body text-sm">No hay sedes registradas todavía.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Sede</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Grupo</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Zona</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Ciudad</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3 w-24">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sedes.map(s => {
                const meta = s.grupo_codigo ? GRUPO_LABELS[s.grupo_codigo] : null
                return (
                  <tr key={s.id} className="hover:bg-gray-50/50 group">
                    <td className="px-4 py-3">
                      <p className="font-body font-medium text-sm text-gray-900">{s.nombre}</p>
                      {s.codigo_interno && <p className="font-body text-xs text-gray-400">N° {s.codigo_interno}</p>}
                    </td>
                    <td className="px-4 py-3">{meta && <span className={`font-body text-xs px-2 py-0.5 rounded-full ${meta.color}`}>{meta.nombre}</span>}</td>
                    <td className="px-4 py-3 font-body text-sm text-gray-500">{s.zona ?? '—'}</td>
                    <td className="px-4 py-3 font-body text-sm text-gray-500">{s.ciudad}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setEditing(s); setShowForm(true) }} title="Editar"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 opacity-0 group-hover:opacity-100 transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <DeleteButton action={eliminarSede} id={s.id} mensaje={`¿Eliminar sede “${s.nombre}”?`}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </DeleteButton>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
