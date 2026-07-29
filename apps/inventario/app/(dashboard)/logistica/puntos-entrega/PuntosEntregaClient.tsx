'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  MapPin, MapPinOff, Search, Building2, Navigation, Users, Layers, X,
} from 'lucide-react'
import Link from 'next/link'
import type { PuntoMapa } from '@/components/logistica/MapaLeaflet'

const MapaLeaflet = dynamic(() => import('@/components/logistica/MapaLeaflet'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 520 }} className="flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl">
      Cargando mapa…
    </div>
  ),
})

interface Cliente { id: string; codigo: string; nombre: string }
interface Sede {
  id: string; nombre: string; ciudad: string; zona: string | null
  codigo_interno: string | null; direccion: string | null
  lat: number | null; lng: number | null
  grupo_id: string; grupo: Cliente | null
}

interface Props { sedesIniciales: Sede[] }

// Paleta estable para colorear por cliente en el mapa.
const PALETA = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#0891b2', '#db2777', '#ca8a04', '#4f46e5', '#16a34a', '#dc2626']

export default function PuntosEntregaClient({ sedesIniciales }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [clienteSel, setClienteSel] = useState<string>('todos')
  const [centrar, setCentrar] = useState<[number, number] | null>(null)
  const [seleccion, setSeleccion] = useState<string | null>(null)

  // Clientes presentes (con color asignado por orden).
  const clientes = useMemo(() => {
    const map = new Map<string, Cliente>()
    for (const s of sedesIniciales) if (s.grupo) map.set(s.grupo.id, s.grupo)
    const arr = [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
    const color: Record<string, string> = {}
    arr.forEach((c, i) => { color[c.id] = PALETA[i % PALETA.length] })
    return { arr, color }
  }, [sedesIniciales])

  const colorDe = (grupoId: string | null | undefined) => (grupoId && clientes.color[grupoId]) || '#6b7280'

  // Filtro por cliente + búsqueda de texto.
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return sedesIniciales.filter(s => {
      if (clienteSel !== 'todos' && s.grupo_id !== clienteSel) return false
      if (!q) return true
      return [s.nombre, s.ciudad, s.zona, s.codigo_interno, s.direccion, s.grupo?.nombre]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    })
  }, [sedesIniciales, busqueda, clienteSel])

  // Puntos del mapa (solo los que tienen coordenadas), coloreados por cliente.
  const puntos = useMemo<PuntoMapa[]>(() =>
    filtradas
      .filter(s => s.lat != null && s.lng != null)
      .map(s => ({
        id: s.id, lat: s.lat as number, lng: s.lng as number, tipo: 'sede' as const,
        titulo: s.nombre, detalle: `${s.grupo?.nombre ?? 'Sin cliente'} · ${s.ciudad}`,
        color: colorDe(s.grupo_id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtradas, clientes])

  // Agrupa la lista por cliente.
  const grupos = useMemo(() => {
    const map = new Map<string, { cliente: Cliente | null; sedes: Sede[] }>()
    for (const s of filtradas) {
      const key = s.grupo_id ?? 'sin'
      if (!map.has(key)) map.set(key, { cliente: s.grupo, sedes: [] })
      map.get(key)!.sedes.push(s)
    }
    return [...map.values()].sort((a, b) => (a.cliente?.nombre ?? 'zzz').localeCompare(b.cliente?.nombre ?? 'zzz'))
  }, [filtradas])

  const total = sedesIniciales.length
  const conUbic = sedesIniciales.filter(s => s.lat != null && s.lng != null).length
  const sinUbic = total - conUbic

  function enfocar(s: Sede) {
    setSeleccion(s.id)
    if (s.lat != null && s.lng != null) setCentrar([s.lat, s.lng])
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg dark:bg-indigo-900">
            <MapPin className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Puntos de Entrega</h1>
            <p className="text-sm text-gray-500">
              {total} sede{total !== 1 ? 's' : ''} · {clientes.arr.length} cliente{clientes.arr.length !== 1 ? 's' : ''} · {conUbic} con ubicación
            </p>
          </div>
        </div>
        <Link href="/contratos"
          className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700">
          <Building2 className="h-4 w-4" /> Gestionar sedes
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<MapPin className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />} bg="bg-indigo-100 dark:bg-indigo-900" valor={total} etiqueta="Puntos de entrega" />
        <Kpi icon={<Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />} bg="bg-blue-100 dark:bg-blue-900" valor={clientes.arr.length} etiqueta="Clientes" />
        <Kpi icon={<Navigation className="h-5 w-5 text-green-600 dark:text-green-400" />} bg="bg-green-100 dark:bg-green-900" valor={conUbic} etiqueta="Con ubicación" />
        <Kpi icon={<MapPinOff className="h-5 w-5 text-amber-600 dark:text-amber-400" />} bg="bg-amber-100 dark:bg-amber-900" valor={sinUbic} etiqueta="Sin ubicación" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar sede, ciudad, zona, contrato…"
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setClienteSel('todos')}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border ${clienteSel === 'todos' ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900' : 'dark:border-gray-700'}`}>
            <Layers className="h-3.5 w-3.5" /> Todos
          </button>
          {clientes.arr.map(c => (
            <button key={c.id} onClick={() => setClienteSel(c.id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${clienteSel === c.id ? 'text-white border-transparent' : 'dark:border-gray-700'}`}
              style={clienteSel === c.id ? { background: clientes.color[c.id] } : undefined}>
              <span className="w-2 h-2 rounded-full" style={{ background: clientes.color[c.id] }} />
              {c.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mapa */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 overflow-hidden p-1">
            <MapaLeaflet puntos={puntos} alto={520} centrarEn={centrar} />
          </div>
          {conUbic === 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <MapPinOff className="h-3.5 w-3.5" />
              Ninguna sede tiene coordenadas todavía. Agrégalas en Contratos/Sedes (Geocodificar o Mi ubicación).
            </p>
          )}
        </div>

        {/* Lista agrupada por cliente */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 overflow-hidden flex flex-col" style={{ maxHeight: 560 }}>
          <div className="px-4 py-2.5 border-b dark:border-gray-800 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{filtradas.length} sede{filtradas.length !== 1 ? 's' : ''}</p>
            {(busqueda || clienteSel !== 'todos') && (
              <button onClick={() => { setBusqueda(''); setClienteSel('todos') }} className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">
                <X className="h-3 w-3" /> Limpiar
              </button>
            )}
          </div>
          <div className="overflow-y-auto divide-y dark:divide-gray-800">
            {grupos.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">Sin resultados</div>}
            {grupos.map(g => (
              <div key={g.cliente?.id ?? 'sin'}>
                <div className="sticky top-0 bg-gray-50 dark:bg-gray-800 px-4 py-1.5 flex items-center gap-2 z-[1]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorDe(g.cliente?.id) }} />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{g.cliente?.nombre ?? 'Sin cliente'}</span>
                  <span className="text-xs text-gray-400">{g.sedes.length}</span>
                </div>
                {g.sedes.map(s => {
                  const tieneUbic = s.lat != null && s.lng != null
                  return (
                    <button key={s.id} onClick={() => enfocar(s)}
                      className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 ${seleccion === s.id ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
                      {tieneUbic
                        ? <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: colorDe(s.grupo_id) }} />
                        : <MapPinOff className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-300" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.nombre}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {s.direccion ? s.direccion : `${s.ciudad}${s.zona ? ` · ${s.zona}` : ''}`}
                          {s.codigo_interno ? ` · N° ${s.codigo_interno}` : ''}
                        </p>
                      </div>
                      {!tieneUbic && <span className="text-[10px] text-amber-500 flex-shrink-0 mt-0.5">sin ubic.</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ icon, bg, valor, etiqueta }: { icon: React.ReactNode; bg: string; valor: React.ReactNode; etiqueta: string }) {
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
