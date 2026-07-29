'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  ClipboardList, Plus, Truck, MapPin, CheckCircle2, AlertTriangle,
  Clock, Package, ChevronDown, ChevronUp, Calendar, User, GripVertical
} from 'lucide-react'
import { crearRuta } from '../actions'
import Link from 'next/link'

interface OrdenDisponible {
  id: string; numero: string; estado: string; conductor_id: string | null
  sede: { id: string; nombre: string; ciudad: string } | null
}
interface ConductorRow {
  id: string; usuario: { id: string; nombre: string; email: string } | null
  placa_vehiculo: string | null; tipo_vehiculo: string | null; zona: string | null
}
interface Parada {
  id: string; numero_parada: number; estado: string
  sede: { nombre: string; ciudad: string } | null
  orden: { id: string; numero: string; estado: string } | null
  confirmacion: { receptor_nombre: string } | null
  novedades: { id: string; tipo: string; estado: string }[] | null
}
interface Ruta {
  id: string; codigo: string; fecha: string; estado: string; observaciones: string | null
  conductor: ConductorRow | null
  paradas: Parada[]
}

interface Props {
  rutasIniciales: Ruta[]
  conductoresDisponibles: ConductorRow[]
  ordenesDisponibles: OrdenDisponible[]
  fechaHoy: string
}

export default function ControlRutasClient({ rutasIniciales, conductoresDisponibles, ordenesDisponibles, fechaHoy }: Props) {
  const [rutas, setRutas] = useState(rutasIniciales)
  const [rutaAbierta, setRutaAbierta] = useState<string | null>(null)
  const [modalCrear, setModalCrear] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [fecha, setFecha] = useState(fechaHoy)

  // Formulario nueva ruta
  const [conductorSeleccionado, setConductorSeleccionado] = useState('')
  const [ordenesSeleccionadas, setOrdenesSeleccionadas] = useState<string[]>([])
  const [observaciones, setObservaciones] = useState('')

  function toggleOrden(id: string) {
    setOrdenesSeleccionadas(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleCrearRuta() {
    if (!conductorSeleccionado || ordenesSeleccionadas.length === 0) {
      toast.error('Selecciona un conductor y al menos una orden')
      return
    }
    setCargando(true)
    try {
      await crearRuta({
        conductor_id: conductorSeleccionado,
        fecha,
        observaciones: observaciones || undefined,
        orden_ids: ordenesSeleccionadas,
      })
      toast.success('Ruta creada exitosamente')
      setModalCrear(false)
      setConductorSeleccionado('')
      setOrdenesSeleccionadas([])
      setObservaciones('')
      window.location.reload()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al crear ruta')
    } finally {
      setCargando(false)
    }
  }

  const estadoColor: Record<string, string> = {
    PENDIENTE:  'bg-gray-100 text-gray-700 dark:bg-gray-800',
    EN_CURSO:   'bg-blue-100 text-blue-700 dark:bg-blue-900',
    COMPLETADA: 'bg-green-100 text-green-700 dark:bg-green-900',
    CANCELADA:  'bg-red-100 text-red-700 dark:bg-red-900',
  }

  const paradaEstadoIcon: Record<string, React.ReactNode> = {
    PENDIENTE:    <div className="w-3 h-3 rounded-full bg-gray-300" />,
    EN_RUTA:      <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />,
    ENTREGADO:    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
    NOVEDAD:      <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
    REPROGRAMADO: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
            <ClipboardList className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Control de Rutas</h1>
            <p className="text-sm text-gray-500">{rutas.length} ruta{rutas.length !== 1 ? 's' : ''} para {fecha}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border rounded-lg px-3 py-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className="text-sm bg-transparent dark:text-white" />
          </div>
          <Link href="/logistica/mapa"
            className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            <MapPin className="h-4 w-4" /> Mapa en vivo
          </Link>
          <button
            onClick={() => setModalCrear(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Nueva ruta
          </button>
        </div>
      </div>

      {/* Órdenes pendientes de asignar */}
      {ordenesDisponibles.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {ordenesDisponibles.length} orden{ordenesDisponibles.length !== 1 ? 'es' : ''} despachada{ordenesDisponibles.length !== 1 ? 's' : ''} sin conductor asignado
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ordenesDisponibles.map(o => (
              <span key={o.id} className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">
                {o.numero} · {o.sede?.nombre}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rutas del día */}
      <div className="space-y-3">
        {rutas.map(ruta => {
          const completadas = ruta.paradas.filter(p => p.estado === 'ENTREGADO').length
          const total = ruta.paradas.length
          const abierta = rutaAbierta === ruta.id

          return (
            <div key={ruta.id} className="bg-white dark:bg-gray-900 rounded-xl border overflow-hidden">
              <button
                onClick={() => setRutaAbierta(abierta ? null : ruta.id)}
                className="w-full flex items-center gap-4 p-4 text-left"
              >
                <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <Truck className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-white">{ruta.conductor?.usuario?.nombre ?? '—'}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoColor[ruta.estado]}`}>
                      {ruta.estado.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{ruta.codigo} · {ruta.conductor?.placa_vehiculo ?? 'Sin placa'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{completadas}/{total}</p>
                  <p className="text-xs text-gray-500">entregas</p>
                </div>
                {abierta ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>

              {/* Barra de progreso */}
              {total > 0 && (
                <div className="px-4 pb-1">
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${(completadas / total) * 100}%` }} />
                  </div>
                </div>
              )}

              {/* Paradas expandidas */}
              {abierta && (
                <div className="border-t divide-y dark:divide-gray-800">
                  {ruta.paradas
                    .sort((a, b) => a.numero_parada - b.numero_parada)
                    .map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        {paradaEstadoIcon[p.estado] ?? paradaEstadoIcon.PENDIENTE}
                      </div>
                      <div className="w-5 h-5 flex-shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{p.numero_parada}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.sede?.nombre}</p>
                        <p className="text-xs text-gray-500">{p.sede?.ciudad} · {p.orden?.numero}</p>
                      </div>
                      {p.confirmacion && (
                        <span className="text-xs text-green-600 dark:text-green-400">✓ {p.confirmacion.receptor_nombre}</span>
                      )}
                      {p.novedades && p.novedades.length > 0 && (
                        <span className="text-xs text-red-600 dark:text-red-400">⚠ {p.novedades.length} novedad</span>
                      )}
                    </div>
                  ))}
                  {ruta.observaciones && (
                    <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800">
                      {ruta.observaciones}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {rutas.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin rutas para {fecha}</p>
          <p className="text-sm">Crea una nueva ruta para asignar órdenes a los conductores</p>
        </div>
      )}

      {/* Modal crear ruta */}
      {modalCrear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <h2 className="text-lg font-bold">Nueva ruta de entrega</h2>

            {/* Fecha */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Fecha de entrega</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
            </div>

            {/* Conductor */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
                <User className="h-4 w-4" /> Conductor *
              </label>
              <select value={conductorSeleccionado}
                onChange={e => setConductorSeleccionado(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">Seleccionar conductor...</option>
                {conductoresDisponibles.filter(c => (c as unknown as {activo: boolean}).activo !== false).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.usuario?.nombre} · {c.placa_vehiculo ?? 'Sin placa'} · {c.zona ?? 'Sin zona'}
                  </option>
                ))}
              </select>
            </div>

            {/* Órdenes disponibles */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                <Package className="h-4 w-4" /> Órdenes a asignar *
                <span className="text-xs text-gray-400">({ordenesSeleccionadas.length} seleccionadas)</span>
              </label>
              {ordenesDisponibles.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-4 border rounded-lg">
                  No hay órdenes despachadas disponibles
                </div>
              ) : (
                <div className="border rounded-xl divide-y dark:divide-gray-800 max-h-64 overflow-y-auto">
                  {ordenesDisponibles.map(o => (
                    <label key={o.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${ordenesSeleccionadas.includes(o.id) ? 'bg-blue-50 dark:bg-blue-950' : ''}`}>
                      <input type="checkbox" checked={ordenesSeleccionadas.includes(o.id)}
                        onChange={() => toggleOrden(o.id)}
                        className="rounded" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{o.sede?.nombre ?? '—'}</p>
                        <p className="text-xs text-gray-500">{o.numero} · {o.sede?.ciudad}</p>
                      </div>
                      <GripVertical className="h-4 w-4 text-gray-300" />
                    </label>
                  ))}
                </div>
              )}
              {ordenesSeleccionadas.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">El orden de visita coincide con el orden de selección</p>
              )}
            </div>

            {/* Observaciones */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Observaciones para el conductor</label>
              <textarea value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Ej: Iniciar por el norte, respetar horarios AM..."
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setModalCrear(false)}
                className="flex-1 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button
                onClick={handleCrearRuta}
                disabled={cargando || !conductorSeleccionado || ordenesSeleccionadas.length === 0}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {cargando ? 'Creando...' : `Crear ruta (${ordenesSeleccionadas.length} paradas)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
