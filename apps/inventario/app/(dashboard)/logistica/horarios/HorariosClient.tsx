'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Clock, Plus, Search, Edit2, Phone, User } from 'lucide-react'
import { upsertHorarioSede } from '../actions'

interface HorarioSede {
  id: string
  sede_id: string
  ventana_am_inicio: string | null; ventana_am_fin: string | null
  ventana_pm_inicio: string | null; ventana_pm_fin: string | null
  supervisor_nombre: string | null; supervisor_contacto: string | null
  notas: string | null; activo: boolean
  sede: { id: string; nombre: string; ciudad: string; zona: string | null } | null
}

interface Sede { id: string; nombre: string; ciudad: string; zona: string | null }

interface Props {
  horariosIniciales: HorarioSede[]
  sedesDisponibles: Sede[]
}

const HORAS_EJEMPLO = [
  ['08:00','09:00','10:00','11:00','12:00'],
  ['13:00','14:00','15:00','16:00','17:00'],
]

export default function HorariosClient({ horariosIniciales, sedesDisponibles }: Props) {
  const [horarios, setHorarios] = useState(horariosIniciales)
  const [busqueda, setBusqueda] = useState('')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<HorarioSede | null>(null)
  const [cargando, setCargando] = useState(false)

  const [form, setForm] = useState({
    sede_id: '',
    ventana_am_inicio: '',
    ventana_am_fin: '',
    ventana_pm_inicio: '',
    ventana_pm_fin: '',
    supervisor_nombre: '',
    supervisor_contacto: '',
    notas: '',
  })

  function abrir(h?: HorarioSede) {
    if (h) {
      setEditando(h)
      setForm({
        sede_id: h.sede_id,
        ventana_am_inicio: h.ventana_am_inicio ?? '',
        ventana_am_fin: h.ventana_am_fin ?? '',
        ventana_pm_inicio: h.ventana_pm_inicio ?? '',
        ventana_pm_fin: h.ventana_pm_fin ?? '',
        supervisor_nombre: h.supervisor_nombre ?? '',
        supervisor_contacto: h.supervisor_contacto ?? '',
        notas: h.notas ?? '',
      })
    } else {
      setEditando(null)
      setForm({ sede_id: '', ventana_am_inicio: '08:00', ventana_am_fin: '11:00', ventana_pm_inicio: '14:00', ventana_pm_fin: '16:00', supervisor_nombre: '', supervisor_contacto: '', notas: '' })
    }
    setModalAbierto(true)
  }

  async function guardar() {
    if (!form.sede_id) { toast.error('Selecciona una sede'); return }
    setCargando(true)
    try {
      await upsertHorarioSede({
        sede_id: form.sede_id,
        ventana_am_inicio: form.ventana_am_inicio || null,
        ventana_am_fin: form.ventana_am_fin || null,
        ventana_pm_inicio: form.ventana_pm_inicio || null,
        ventana_pm_fin: form.ventana_pm_fin || null,
        supervisor_nombre: form.supervisor_nombre || null,
        supervisor_contacto: form.supervisor_contacto || null,
        notas: form.notas || null,
      })
      toast.success('Horario guardado')
      setModalAbierto(false)
      window.location.reload()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setCargando(false)
    }
  }

  const filtrados = horarios.filter(h =>
    !busqueda || h.sede?.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    h.supervisor_nombre?.toLowerCase().includes(busqueda.toLowerCase())
  )

  const sedesSinHorario = sedesDisponibles.filter(s => !horarios.find(h => h.sede_id === s.id))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg dark:bg-purple-900">
            <Clock className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Horarios de Entrega</h1>
            <p className="text-sm text-gray-500">{horarios.length} sede{horarios.length !== 1 ? 's' : ''} configurada{horarios.length !== 1 ? 's' : ''} · {sedesSinHorario.length} sin configurar</p>
          </div>
        </div>
        <button onClick={() => abrir()}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
          <Plus className="h-4 w-4" /> Agregar horario
        </button>
      </div>

      {/* Sedes sin horario */}
      {sedesSinHorario.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
            {sedesSinHorario.length} sede{sedesSinHorario.length !== 1 ? 's' : ''} sin horario de entrega configurado:
          </p>
          <div className="flex flex-wrap gap-2">
            {sedesSinHorario.slice(0, 10).map(s => (
              <button key={s.id} onClick={() => { setEditando(null); setForm(p => ({...p, sede_id: s.id})); setModalAbierto(true) }}
                className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800">
                {s.nombre}
              </button>
            ))}
            {sedesSinHorario.length > 10 && <span className="text-xs text-yellow-600">+{sedesSinHorario.length - 10} más</span>}
          </div>
        </div>
      )}

      {/* Búsqueda */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Buscar por sede o supervisor..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm dark:bg-gray-900 dark:border-gray-700" />
      </div>

      {/* Tabla / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtrados.map(h => (
          <div key={h.id} className="bg-white dark:bg-gray-900 rounded-xl border p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{h.sede?.nombre}</p>
                <p className="text-xs text-gray-500">{h.sede?.ciudad} · {h.sede?.zona ?? 'Sin zona'}</p>
              </div>
              <button onClick={() => abrir(h)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                <Edit2 className="h-4 w-4 text-gray-400" />
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              {(h.ventana_am_inicio || h.ventana_am_fin) && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">AM</span>
                  <span>{h.ventana_am_inicio} – {h.ventana_am_fin}</span>
                </div>
              )}
              {(h.ventana_pm_inicio || h.ventana_pm_fin) && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">PM</span>
                  <span>{h.ventana_pm_inicio} – {h.ventana_pm_fin}</span>
                </div>
              )}
            </div>

            {(h.supervisor_nombre || h.supervisor_contacto) && (
              <div className="border-t pt-2 space-y-1 text-xs">
                {h.supervisor_nombre && (
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                    <User className="h-3.5 w-3.5" /> {h.supervisor_nombre}
                  </div>
                )}
                {h.supervisor_contacto && (
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                    <Phone className="h-3.5 w-3.5" />
                    <a href={`tel:${h.supervisor_contacto}`} className="text-blue-600 hover:underline">{h.supervisor_contacto}</a>
                  </div>
                )}
              </div>
            )}

            {h.notas && (
              <p className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1">{h.notas}</p>
            )}
          </div>
        ))}
      </div>

      {filtrados.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin horarios configurados</p>
        </div>
      )}

      {/* Modal editar / crear */}
      {modalAbierto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold">{editando ? 'Editar horario' : 'Nuevo horario'}</h2>

            {/* Sede */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Sede *</label>
              <select value={form.sede_id}
                onChange={e => setForm(p => ({...p, sede_id: e.target.value}))}
                disabled={!!editando}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 disabled:opacity-60"
              >
                <option value="">Seleccionar sede...</option>
                {sedesDisponibles.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre} — {s.ciudad}</option>
                ))}
              </select>
            </div>

            {/* Ventana AM */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs font-bold mr-1">AM</span>
                Ventana de la mañana
              </label>
              <div className="flex gap-2 items-center">
                <input type="time" value={form.ventana_am_inicio}
                  onChange={e => setForm(p => ({...p, ventana_am_inicio: e.target.value}))}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
                <span className="text-gray-400 text-sm">a</span>
                <input type="time" value={form.ventana_am_fin}
                  onChange={e => setForm(p => ({...p, ventana_am_fin: e.target.value}))}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
              </div>
            </div>

            {/* Ventana PM */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs font-bold mr-1">PM</span>
                Ventana de la tarde <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <div className="flex gap-2 items-center">
                <input type="time" value={form.ventana_pm_inicio}
                  onChange={e => setForm(p => ({...p, ventana_pm_inicio: e.target.value}))}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
                <span className="text-gray-400 text-sm">a</span>
                <input type="time" value={form.ventana_pm_fin}
                  onChange={e => setForm(p => ({...p, ventana_pm_fin: e.target.value}))}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
              </div>
            </div>

            {/* Supervisor */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                  <User className="h-3.5 w-3.5" /> Supervisor
                </label>
                <input type="text" value={form.supervisor_nombre}
                  onChange={e => setForm(p => ({...p, supervisor_nombre: e.target.value}))}
                  placeholder="Nombre del supervisor"
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> Contacto
                </label>
                <input type="text" value={form.supervisor_contacto}
                  onChange={e => setForm(p => ({...p, supervisor_contacto: e.target.value}))}
                  placeholder="310 000 0000"
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
              </div>
            </div>

            {/* Notas */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Notas para el conductor</label>
              <textarea value={form.notas}
                onChange={e => setForm(p => ({...p, notas: e.target.value}))}
                placeholder="Ej: Parqueadero en sótano, pedir permiso en recepción..."
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setModalAbierto(false)}
                className="flex-1 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button onClick={guardar} disabled={cargando || !form.sede_id}
                className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                {cargando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
