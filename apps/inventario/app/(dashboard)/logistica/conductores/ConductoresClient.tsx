'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Users, Plus, Truck, Phone, MapPin, Edit2, CheckCircle, XCircle } from 'lucide-react'
import { crearConductor, actualizarConductor } from '../actions'

interface ConductorRow {
  id: string
  placa_vehiculo: string | null
  tipo_vehiculo: string | null
  telefono_contacto: string | null
  zona: string | null
  licencia_categoria: string | null
  activo: boolean
  usuario: { id: string; nombre: string; email: string; rol: string } | null
}

interface Props {
  conductoresIniciales: ConductorRow[]
}

export default function ConductoresClient({ conductoresIniciales }: Props) {
  const [conductores, setConductores] = useState(conductoresIniciales)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<ConductorRow | null>(null)
  const [cargando, setCargando] = useState(false)

  const [form, setForm] = useState({
    usuario_id: '',
    placa_vehiculo: '',
    tipo_vehiculo: 'CAMION',
    telefono_contacto: '',
    zona: '',
    licencia_categoria: 'C2',
  })

  function abrirNuevo() {
    setEditando(null)
    setForm({ usuario_id: '', placa_vehiculo: '', tipo_vehiculo: 'CAMION', telefono_contacto: '', zona: '', licencia_categoria: 'C2' })
    setModalAbierto(true)
  }

  function abrirEditar(c: ConductorRow) {
    setEditando(c)
    setForm({
      usuario_id: c.usuario?.id ?? '',
      placa_vehiculo: c.placa_vehiculo ?? '',
      tipo_vehiculo: c.tipo_vehiculo ?? 'CAMION',
      telefono_contacto: c.telefono_contacto ?? '',
      zona: c.zona ?? '',
      licencia_categoria: c.licencia_categoria ?? 'C2',
    })
    setModalAbierto(true)
  }

  async function guardar() {
    setCargando(true)
    try {
      if (editando) {
        await actualizarConductor(editando.id, {
          placa_vehiculo: form.placa_vehiculo || undefined,
          tipo_vehiculo: form.tipo_vehiculo || undefined,
          telefono_contacto: form.telefono_contacto || undefined,
          zona: form.zona || undefined,
          licencia_categoria: form.licencia_categoria || undefined,
        })
        toast.success('Conductor actualizado')
      } else {
        await crearConductor({
          usuario_id: form.usuario_id,
          placa_vehiculo: form.placa_vehiculo || undefined,
          tipo_vehiculo: form.tipo_vehiculo || undefined,
          telefono_contacto: form.telefono_contacto || undefined,
          zona: form.zona || undefined,
          licencia_categoria: form.licencia_categoria || undefined,
        })
        toast.success('Conductor creado')
      }
      setModalAbierto(false)
      window.location.reload()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setCargando(false)
    }
  }

  async function toggleActivo(c: ConductorRow) {
    try {
      await actualizarConductor(c.id, { activo: !c.activo })
      setConductores(prev => prev.map(x => x.id === c.id ? { ...x, activo: !c.activo } : x))
      toast.success(c.activo ? 'Conductor desactivado' : 'Conductor activado')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-100 rounded-lg dark:bg-sky-900">
            <Users className="h-6 w-6 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Conductores</h1>
            <p className="text-sm text-gray-500">{conductores.length} registrado{conductores.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button
          onClick={abrirNuevo}
          className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Nuevo conductor
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {conductores.map(c => (
          <div key={c.id} className={`bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-3 ${!c.activo ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{c.usuario?.nombre ?? '—'}</p>
                <p className="text-xs text-gray-500">{c.usuario?.email}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => abrirEditar(c)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  <Edit2 className="h-4 w-4 text-gray-400" />
                </button>
                <button onClick={() => toggleActivo(c)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  {c.activo
                    ? <CheckCircle className="h-4 w-4 text-green-500" />
                    : <XCircle className="h-4 w-4 text-red-400" />
                  }
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                <Truck className="h-3.5 w-3.5" />
                <span>{c.placa_vehiculo ?? 'Sin placa'} · {c.tipo_vehiculo ?? '—'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                <Phone className="h-3.5 w-3.5" />
                <span>{c.telefono_contacto ?? '—'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                <MapPin className="h-3.5 w-3.5" />
                <span>{c.zona ?? 'Sin zona'}</span>
              </div>
              <div className="text-gray-600 dark:text-gray-400">
                Lic. {c.licencia_categoria ?? '—'}
              </div>
            </div>

            <div className={`text-xs font-medium px-2 py-1 rounded-full inline-block ${c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {c.activo ? 'Activo' : 'Inactivo'}
            </div>
          </div>
        ))}
      </div>

      {conductores.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay conductores registrados</p>
          <p className="text-sm">Crea el primero para empezar a asignar rutas</p>
        </div>
      )}

      {/* Modal */}
      {modalAbierto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">{editando ? 'Editar conductor' : 'Nuevo conductor'}</h2>

            {!editando && (
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">ID de usuario *</label>
                <input
                  type="text"
                  placeholder="UUID del usuario con rol CONDUCTOR"
                  value={form.usuario_id}
                  onChange={e => setForm(p => ({ ...p, usuario_id: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
                />
                <p className="text-xs text-gray-400 mt-1">El usuario debe existir en el sistema y tener rol CONDUCTOR</p>
              </div>
            )}

            {[
              { key: 'placa_vehiculo', label: 'Placa del vehículo', placeholder: 'ABC123' },
              { key: 'tipo_vehiculo',  label: 'Tipo de vehículo',   placeholder: 'CAMION / FURGON / MOTO' },
              { key: 'telefono_contacto', label: 'Teléfono', placeholder: '310 000 0000' },
              { key: 'zona', label: 'Zona asignada', placeholder: 'Norte / Sur / Centro' },
              { key: 'licencia_categoria', label: 'Categoría de licencia', placeholder: 'C2 / B1' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
                <input
                  type="text"
                  placeholder={placeholder}
                  value={form[key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
                />
              </div>
            ))}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModalAbierto(false)}
                className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={cargando || (!editando && !form.usuario_id)}
                className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
              >
                {cargando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
