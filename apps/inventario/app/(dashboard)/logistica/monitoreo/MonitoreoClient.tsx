'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Radio, Truck, Package, CheckCircle2, AlertTriangle, Clock, MapPin,
  Phone, Navigation, ChevronDown, ChevronUp, RefreshCw, Calendar, User, PackageCheck,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getMonitoreoEntregas } from '../actions'

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface Ubicacion {
  conductor_id: string
  lat: number; lng: number
  velocidad_kmh: number | null
  activo: boolean
  updated_at: string
}
interface ItemOrden {
  id: string
  cantidad_solicitada: number | null
  producto: { nombre_estandar: string; presentacion: string | null } | null
}
interface Parada {
  id: string; numero_parada: number; estado: string
  sede: { id: string; nombre: string; ciudad: string; zona: string | null } | null
  orden: { id: string; numero: string; estado: string; items: ItemOrden[] | null } | null
  confirmacion: { receptor_nombre: string; created_at: string } | null
  novedades: { id: string; tipo: string; estado: string }[] | null
}
interface ConductorRow {
  id: string; placa_vehiculo: string | null; tipo_vehiculo: string | null
  zona: string | null; telefono_contacto: string | null; activo: boolean | null
  usuario: { id: string; nombre: string; email: string } | null
}
interface Ruta {
  id: string; codigo: string; fecha: string; estado: string; observaciones: string | null
  conductor: ConductorRow | null
  paradas: Parada[]
}

interface Props {
  rutasIniciales: Ruta[]
  ubicacionesIniciales: Ubicacion[]
  fechaHoy: string
}

const REFRESCO_MS = 25_000

export default function MonitoreoClient({ rutasIniciales, ubicacionesIniciales, fechaHoy }: Props) {
  const [rutas, setRutas] = useState<Ruta[]>(rutasIniciales)
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>(ubicacionesIniciales)
  const [fecha, setFecha] = useState(fechaHoy)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [ultima, setUltima] = useState(() => new Date(fechaHoy + 'T00:00:00'))
  const [refrescando, setRefrescando] = useState(false)
  const supabase = createClient()

  // Refresca el detalle de rutas (paradas no viajan por Realtime, así que sondeamos).
  const refrescar = useCallback(async (dia: string) => {
    setRefrescando(true)
    try {
      const data = await getMonitoreoEntregas(dia)
      setRutas(data as Ruta[])
      setUltima(new Date())
    } catch {
      /* silencioso: el próximo ciclo reintenta */
    } finally {
      setRefrescando(false)
    }
  }, [])

  // Sondeo periódico + al cambiar de fecha
  useEffect(() => {
    refrescar(fecha)
    const id = setInterval(() => refrescar(fecha), REFRESCO_MS)
    return () => clearInterval(id)
  }, [fecha, refrescar])

  // GPS en tiempo real (posición y estado activo del conductor)
  useEffect(() => {
    const canal = supabase
      .channel('monitoreo-ubicaciones')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'conductor_ubicacion_actual',
      }, (payload) => {
        const nueva = payload.new as Ubicacion
        setUbicaciones(prev => {
          const idx = prev.findIndex(u => u.conductor_id === nueva.conductor_id)
          if (idx >= 0) {
            const copia = [...prev]
            copia[idx] = { ...copia[idx], ...nueva }
            return copia
          }
          return [...prev, nueva]
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [supabase])

  const ubicDe = (conductorId?: string | null) =>
    conductorId ? ubicaciones.find(u => u.conductor_id === conductorId) : undefined

  function tiempoDesde(iso: string) {
    const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seg < 5) return 'ahora'
    if (seg < 60) return `hace ${seg}s`
    if (seg < 3600) return `hace ${Math.floor(seg / 60)}min`
    return `hace ${Math.floor(seg / 3600)}h`
  }

  // ─── KPIs globales ──────────────────────────────────────────────────────
  const totalParadas = rutas.reduce((n, r) => n + r.paradas.length, 0)
  const entregadas = rutas.reduce((n, r) => n + r.paradas.filter(p => p.estado === 'ENTREGADO').length, 0)
  const novedadesAbiertas = rutas.reduce(
    (n, r) => n + r.paradas.reduce((m, p) => m + (p.novedades?.filter(x => x.estado !== 'RESUELTA').length ?? 0), 0), 0
  )
  const conductoresEnRuta = rutas.filter(r => ubicDe(r.conductor?.id)?.activo).length

  const estadoRutaColor: Record<string, string> = {
    PENDIENTE:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    EN_CURSO:   'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    COMPLETADA: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    CANCELADA:  'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  }

  function iconoParada(estado: string) {
    switch (estado) {
      case 'ENTREGADO':    return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'EN_RUTA':      return <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
      case 'NOVEDAD':      return <AlertTriangle className="h-4 w-4 text-red-500" />
      case 'REPROGRAMADO': return <Clock className="h-4 w-4 text-yellow-500" />
      default:             return <div className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg dark:bg-emerald-900">
            <Radio className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tablero de Entregas en Vivo</h1>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span>{rutas.length} ruta{rutas.length !== 1 ? 's' : ''} · {conductoresEnRuta} conductor{conductoresEnRuta !== 1 ? 'es' : ''} en ruta</span>
              <span>·</span>
              <RefreshCw className={`h-3 w-3 ${refrescando ? 'animate-spin' : ''}`} />
              <span>Actualizado {tiempoDesde(ultima.toISOString())}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border rounded-lg px-3 py-2 dark:border-gray-700">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className="text-sm bg-transparent dark:text-white" />
          </div>
          <button onClick={() => refrescar(fecha)}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700">
            <RefreshCw className={`h-4 w-4 ${refrescando ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <Link href="/logistica/mapa"
            className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700">
            <MapPin className="h-4 w-4" /> Mapa
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<Navigation className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
          bg="bg-blue-100 dark:bg-blue-900" valor={conductoresEnRuta} etiqueta="En ruta ahora" />
        <KpiCard icon={<PackageCheck className="h-5 w-5 text-green-600 dark:text-green-400" />}
          bg="bg-green-100 dark:bg-green-900" valor={`${entregadas}/${totalParadas}`} etiqueta="Entregas realizadas" />
        <KpiCard icon={<Package className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
          bg="bg-amber-100 dark:bg-amber-900" valor={totalParadas - entregadas} etiqueta="Entregas pendientes" />
        <KpiCard icon={<AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />}
          bg="bg-red-100 dark:bg-red-900" valor={novedadesAbiertas} etiqueta="Novedades abiertas" />
      </div>

      {/* Tarjetas por conductor */}
      {rutas.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin rutas para {fecha}</p>
          <p className="text-sm">No hay conductores con entregas asignadas este día</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {rutas.map(ruta => {
            const total = ruta.paradas.length
            const hechas = ruta.paradas.filter(p => p.estado === 'ENTREGADO').length
            const conNovedad = ruta.paradas.filter(p => p.estado === 'NOVEDAD').length
            const pct = total ? Math.round((hechas / total) * 100) : 0
            const ubic = ubicDe(ruta.conductor?.id)
            const activo = !!ubic?.activo
            const totalItems = ruta.paradas.reduce((n, p) => n + (p.orden?.items?.length ?? 0), 0)
            const estaAbierta = abierta === ruta.id

            return (
              <div key={ruta.id} className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 overflow-hidden">
                {/* Cabecera conductor */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div className="p-2.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <Truck className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${activo ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">
                          {ruta.conductor?.usuario?.nombre ?? 'Sin conductor'}
                        </p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoRutaColor[ruta.estado] ?? estadoRutaColor.PENDIENTE}`}>
                          {ruta.estado.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap mt-0.5">
                        <span>{ruta.conductor?.placa_vehiculo ?? 'Sin placa'}</span>
                        {ruta.conductor?.zona && <><span>·</span><span>{ruta.conductor.zona}</span></>}
                        {ruta.conductor?.telefono_contacto && (
                          <><span>·</span><a href={`tel:${ruta.conductor.telefono_contacto}`} className="flex items-center gap-0.5 hover:text-blue-600">
                            <Phone className="h-3 w-3" />{ruta.conductor.telefono_contacto}</a></>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs mt-1">
                        {activo ? (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <Navigation className="h-3 w-3" />
                            En movimiento{ubic?.velocidad_kmh != null ? ` · ${Math.round(ubic.velocidad_kmh)} km/h` : ''}
                            {ubic?.updated_at ? ` · ${tiempoDesde(ubic.updated_at)}` : ''}
                          </span>
                        ) : (
                          <span className="text-gray-400">GPS inactivo</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{hechas}/{total}</p>
                      <p className="text-xs text-gray-500">entregas</p>
                    </div>
                  </div>

                  {/* Progreso */}
                  <div className="mt-3">
                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-xs">
                      <span className="text-gray-500">{pct}% completado · {totalItems} ítem{totalItems !== 1 ? 's' : ''} a entregar</span>
                      {conNovedad > 0 && (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                          <AlertTriangle className="h-3 w-3" />{conNovedad} novedad{conNovedad !== 1 ? 'es' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <button onClick={() => setAbierta(estaAbierta ? null : ruta.id)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-1.5 border rounded-lg dark:border-gray-800">
                    {estaAbierta ? <>Ocultar detalle <ChevronUp className="h-3.5 w-3.5" /></> : <>Ver qué debe entregar <ChevronDown className="h-3.5 w-3.5" /></>}
                  </button>
                </div>

                {/* Detalle de paradas / entregas */}
                {estaAbierta && (
                  <div className="border-t dark:border-gray-800 divide-y dark:divide-gray-800 bg-gray-50/50 dark:bg-gray-950/30">
                    {ruta.paradas.slice().sort((a, b) => a.numero_parada - b.numero_parada).map(p => (
                      <div key={p.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1 pt-0.5">
                            <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300">
                              {p.numero_parada}
                            </span>
                            {iconoParada(p.estado)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.sede?.nombre ?? '—'}</p>
                              <span className="text-xs text-gray-400 flex-shrink-0">{p.orden?.numero}</span>
                            </div>
                            <p className="text-xs text-gray-500">{p.sede?.ciudad}{p.sede?.zona ? ` · ${p.sede.zona}` : ''}</p>

                            {/* Ítems a entregar */}
                            {p.orden?.items && p.orden.items.length > 0 ? (
                              <ul className="mt-1.5 space-y-0.5">
                                {p.orden.items.map(it => (
                                  <li key={it.id} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                                    <Package className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                    <span className="truncate">{it.producto?.nombre_estandar ?? 'Producto'}</span>
                                    {it.producto?.presentacion && <span className="text-gray-400">({it.producto.presentacion})</span>}
                                    <span className="ml-auto font-medium text-gray-700 dark:text-gray-300 flex-shrink-0">× {it.cantidad_solicitada ?? 0}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-xs text-gray-400 italic">Sin ítems detallados</p>
                            )}

                            {/* Estado de la entrega */}
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              {p.estado === 'ENTREGADO' && p.confirmacion && (
                                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Recibió {p.confirmacion.receptor_nombre}
                                </span>
                              )}
                              {p.novedades && p.novedades.filter(n => n.estado !== 'RESUELTA').length > 0 && (
                                <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" /> {p.novedades.filter(n => n.estado !== 'RESUELTA')[0].tipo?.replace('_', ' ')}
                                </span>
                              )}
                              {p.estado === 'PENDIENTE' && <span className="text-xs text-gray-400">Pendiente</span>}
                              {p.estado === 'EN_RUTA' && <span className="text-xs text-blue-500">En camino</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {ruta.observaciones && (
                      <div className="px-4 py-2 text-xs text-gray-500 flex items-start gap-1.5">
                        <User className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                        <span>{ruta.observaciones}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KpiCard({ icon, bg, valor, etiqueta }: { icon: React.ReactNode; bg: string; valor: React.ReactNode; etiqueta: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-gray-900 dark:text-white leading-none">{valor}</p>
        <p className="text-xs text-gray-500 mt-1 truncate">{etiqueta}</p>
      </div>
    </div>
  )
}
