'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { Map, Truck, Clock, CheckCircle2, AlertTriangle, Navigation, RefreshCw } from 'lucide-react'
import type { PuntoMapa } from '@/components/logistica/MapaLeaflet'

const MapaLeaflet = dynamic(() => import('@/components/logistica/MapaLeaflet'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 480 }} className="flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl">
      Cargando mapa…
    </div>
  ),
})

interface Ubicacion {
  conductor_id: string
  lat: number; lng: number
  precision_metros: number | null
  velocidad_kmh: number | null
  activo: boolean
  updated_at: string
  conductor: { id: string; usuario: { nombre: string } | null } | null
}

interface Novedad { id: string; tipo: string; estado: string; lat: number | null; lng: number | null; descripcion: string | null }
interface Parada {
  id: string; numero_parada: number; estado: string
  sede: { nombre: string; ciudad: string; direccion: string | null; lat: number | null; lng: number | null } | null
  confirmacion: { receptor_nombre: string } | null
  novedades: Novedad[] | null
}
interface Ruta {
  id: string; codigo: string; estado: string
  conductor: { id: string; usuario: { nombre: string; email: string } | null; placa_vehiculo: string | null } | null
  paradas: Parada[]
}

interface Props {
  ubicacionesIniciales: Ubicacion[]
  rutasHoy: Ruta[]
}

export default function MapaLiveClient({ ubicacionesIniciales, rutasHoy }: Props) {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>(ubicacionesIniciales)
  const [conductorSeleccionado, setConductorSeleccionado] = useState<string | null>(null)
  const [ultimaActualizacion, setUltimaActualizacion] = useState(new Date())
  const supabase = createClient()

  // Realtime subscription
  useEffect(() => {
    const canal = supabase
      .channel('conductor-ubicaciones')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conductor_ubicacion_actual' }, (payload) => {
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
        setUltimaActualizacion(new Date())
      })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [supabase])

  const conductorActivo = conductorSeleccionado ? ubicaciones.find(u => u.conductor_id === conductorSeleccionado) : null
  const rutaConductor = conductorSeleccionado
    ? rutasHoy.find(r => r.conductor?.id === conductorSeleccionado || r.conductor?.id === conductorActivo?.conductor?.id)
    : null

  const conductoresActivos = ubicaciones.filter(u => u.activo)

  // Construye los puntos del mapa (conductores + puntos de entrega + novedades).
  const puntos = useMemo<PuntoMapa[]>(() => {
    const out: PuntoMapa[] = []
    // Conductores (todos los activos, o solo el seleccionado)
    const ubics = conductorSeleccionado ? ubicaciones.filter(u => u.conductor_id === conductorSeleccionado) : conductoresActivos
    for (const u of ubics) {
      out.push({
        id: 'c-' + u.conductor_id, lat: u.lat, lng: u.lng, tipo: 'conductor',
        titulo: u.conductor?.usuario?.nombre ?? 'Conductor', activo: u.activo, velocidad: u.velocidad_kmh,
        detalle: 'Actualizado ' + tiempoDesde(u.updated_at),
      })
    }
    // Puntos de entrega (sedes con coordenadas)
    const rutas = conductorSeleccionado ? rutasHoy.filter(r => r.conductor?.id === conductorSeleccionado) : rutasHoy
    for (const r of rutas) {
      for (const p of r.paradas) {
        if (p.sede?.lat != null && p.sede?.lng != null) {
          out.push({
            id: 's-' + p.id, lat: p.sede.lat, lng: p.sede.lng, tipo: 'sede',
            titulo: p.sede.nombre, detalle: `${p.sede.ciudad} · ${p.estado.replace('_', ' ')}`,
            estado: p.estado, orden: p.numero_parada,
          })
        }
        for (const n of p.novedades ?? []) {
          if (n.lat != null && n.lng != null && n.estado !== 'RESUELTA') {
            out.push({
              id: 'n-' + n.id, lat: n.lat, lng: n.lng, tipo: 'novedad',
              titulo: n.tipo.replace('_', ' '), detalle: n.descripcion ?? p.sede?.nombre ?? '',
            })
          }
        }
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicaciones, rutasHoy, conductorSeleccionado])

  const sinCoords = puntos.filter(p => p.tipo === 'sede').length === 0 && rutasHoy.some(r => r.paradas.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
            <Map className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Mapa en Vivo</h1>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span>{conductoresActivos.length} conductor{conductoresActivos.length !== 1 ? 'es' : ''} activo{conductoresActivos.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <RefreshCw className="h-3 w-3" />
              <span>Actualizado {tiempoDesde(ultimaActualizacion.toISOString())}</span>
            </div>
          </div>
        </div>
        {conductorSeleccionado && (
          <button onClick={() => setConductorSeleccionado(null)}
            className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700">
            Ver todos
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mapa Leaflet / OpenStreetMap */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 overflow-hidden p-1">
            <MapaLeaflet puntos={puntos} dibujarRuta={!!conductorSeleccionado} alto={480} />
          </div>
          {sinCoords && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Algunas sedes no tienen coordenadas. Agrégalas en Contratos/Sedes para verlas en el mapa.
            </p>
          )}
        </div>

        {/* Panel lateral */}
        <div className="space-y-3">
          {conductorActivo && (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-600 rounded-lg"><Truck className="h-4 w-4 text-white" /></div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">{conductorActivo.conductor?.usuario?.nombre}</p>
                  <p className="text-xs text-gray-500">{tiempoDesde(conductorActivo.updated_at)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white dark:bg-gray-900 rounded-lg p-2">
                  <p className="text-gray-500">Velocidad</p>
                  <p className="font-bold text-gray-900 dark:text-white">{conductorActivo.velocidad_kmh != null ? `${Math.round(conductorActivo.velocidad_kmh)} km/h` : '—'}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-lg p-2">
                  <p className="text-gray-500">Precisión GPS</p>
                  <p className="font-bold text-gray-900 dark:text-white">{conductorActivo.precision_metros != null ? `±${Math.round(conductorActivo.precision_metros)}m` : '—'}</p>
                </div>
              </div>
              {rutaConductor && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Paradas ({rutaConductor.paradas.length})</p>
                  {rutaConductor.paradas.slice().sort((a, b) => a.numero_parada - b.numero_parada).map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        p.estado === 'ENTREGADO' ? 'bg-green-500' :
                        p.estado === 'EN_RUTA' ? 'bg-blue-500 animate-pulse' :
                        p.estado === 'NOVEDAD' ? 'bg-red-500' : 'bg-gray-300'
                      }`} />
                      <span className={`truncate ${p.estado === 'ENTREGADO' ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                        {p.numero_parada}. {p.sede?.nombre}
                      </span>
                      {p.sede?.lat == null && <span className="text-[10px] text-amber-500 flex-shrink-0">sin ubic.</span>}
                      {p.confirmacion && <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lista de rutas de hoy */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 divide-y dark:divide-gray-800">
            <div className="px-4 py-2.5"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rutas de hoy</p></div>
            {rutasHoy.length === 0 && <div className="px-4 py-6 text-center text-sm text-gray-400">Sin rutas asignadas</div>}
            {rutasHoy.map(ruta => {
              const completadas = ruta.paradas.filter(p => p.estado === 'ENTREGADO').length
              const novedades = ruta.paradas.filter(p => p.estado === 'NOVEDAD').length
              const ubicActiva = ubicaciones.find(u => u.conductor?.id === ruta.conductor?.id && u.activo)
              return (
                <button key={ruta.id}
                  onClick={() => setConductorSeleccionado(c => c === ruta.conductor?.id ? null : (ruta.conductor?.id ?? null))}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                    conductorSeleccionado === ruta.conductor?.id ? 'bg-blue-50 dark:bg-blue-950' : ''
                  }`}>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ubicActiva ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{ruta.conductor?.usuario?.nombre ?? '—'}</p>
                    <p className="text-xs text-gray-500">{ruta.conductor?.placa_vehiculo ?? 'Sin placa'} · {ruta.estado.replace('_', ' ')}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {novedades > 0 && <span className="flex items-center gap-0.5 text-red-600"><AlertTriangle className="h-3 w-3" />{novedades}</span>}
                    <span className="text-gray-500">{completadas}/{ruta.paradas.length}</span>
                    {ruta.estado === 'COMPLETADA' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                    {ruta.estado === 'EN_CURSO' && <Clock className="h-3.5 w-3.5 text-blue-500" />}
                    <Navigation className="h-3.5 w-3.5 text-gray-300" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function tiempoDesde(iso: string) {
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seg < 60) return `hace ${seg}s`
  if (seg < 3600) return `hace ${Math.floor(seg / 60)}min`
  return `hace ${Math.floor(seg / 3600)}h`
}
