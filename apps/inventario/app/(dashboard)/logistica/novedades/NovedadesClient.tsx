'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Clock, Filter } from 'lucide-react'
import { resolverNovedad, getNovedades } from '../actions'
import { TIPO_NOVEDAD_LABELS } from '@/lib/types/database'

type TipoNovedad = keyof typeof TIPO_NOVEDAD_LABELS

interface Novedad {
  id: string
  tipo: TipoNovedad
  descripcion: string
  estado: string
  foto_url: string | null
  lat: number | null; lng: number | null
  created_at: string
  resolucion: string | null
  conductor: { id: string; usuario: { nombre: string; email: string } | null } | null
  orden: { id: string; numero: string; sede: { nombre: string; ciudad: string } | null } | null
  parada: { id: string; numero_parada: number; sede: { nombre: string } | null } | null
}

interface Props { novedadesIniciales: Novedad[] }

const ESTADO_FILTROS = [
  { value: 'ABIERTA',     label: 'Abiertas' },
  { value: 'EN_GESTION',  label: 'En gestión' },
  { value: 'RESUELTA',    label: 'Resueltas' },
]

export default function NovedadesClient({ novedadesIniciales }: Props) {
  const [novedades, setNovedades] = useState<Novedad[]>(novedadesIniciales)
  const [filtroEstado, setFiltroEstado] = useState('ABIERTA')
  const [modalResolver, setModalResolver] = useState<Novedad | null>(null)
  const [resolucion, setResolucion] = useState('')
  const [cargando, setCargando] = useState(false)

  async function cambiarFiltro(estado: string) {
    setFiltroEstado(estado)
    setCargando(true)
    try {
      const data = await getNovedades({ estado })
      setNovedades(data as unknown as Novedad[])
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setCargando(false)
    }
  }

  async function handleResolver() {
    if (!modalResolver || !resolucion) { toast.error('Ingresa la resolución'); return }
    setCargando(true)
    try {
      await resolverNovedad(modalResolver.id, resolucion)
      setNovedades(prev => prev.filter(n => n.id !== modalResolver.id))
      setModalResolver(null)
      setResolucion('')
      toast.success('Novedad resuelta')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setCargando(false)
    }
  }

  function tiempoDesde(iso: string) {
    const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seg < 60) return `hace ${seg}s`
    if (seg < 3600) return `hace ${Math.floor(seg / 60)}min`
    if (seg < 86400) return `hace ${Math.floor(seg / 3600)}h`
    return new Date(iso).toLocaleDateString('es-CO')
  }

  const estadoColorBadge: Record<string, string> = {
    ABIERTA:    'bg-red-100 text-red-700',
    EN_GESTION: 'bg-yellow-100 text-yellow-700',
    RESUELTA:   'bg-green-100 text-green-700',
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg dark:bg-red-900">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Novedades</h1>
            <p className="text-sm text-gray-500">{novedades.length} novedad{novedades.length !== 1 ? 'es' : ''} · {filtroEstado.toLowerCase()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          {ESTADO_FILTROS.map(f => (
            <button key={f.value}
              onClick={() => cambiarFiltro(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filtroEstado === f.value
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {novedades.map(n => {
          const tipoInfo = TIPO_NOVEDAD_LABELS[n.tipo] ?? { label: n.tipo, color: 'bg-gray-100 text-gray-700' }
          return (
            <div key={n.id} className="bg-white dark:bg-gray-900 rounded-xl border p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${tipoInfo.color}`}>
                    {tipoInfo.label}
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoColorBadge[n.estado]}`}>
                    {n.estado.replace('_', ' ')}
                  </span>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{tiempoDesde(n.created_at)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Conductor</p>
                  <p className="font-medium text-gray-900 dark:text-white">{n.conductor?.usuario?.nombre ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Sede</p>
                  <p className="font-medium text-gray-900 dark:text-white">{n.orden?.sede?.nombre ?? n.parada?.sede?.nombre ?? '—'}</p>
                </div>
                {n.orden && (
                  <div>
                    <p className="text-xs text-gray-500">Orden</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{n.orden.numero}</p>
                  </div>
                )}
              </div>

              <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                {n.descripcion}
              </p>

              {n.resolucion && (
                <div className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{n.resolucion}</span>
                </div>
              )}

              {n.lat && n.lng && (
                <a
                  href={`https://www.google.com/maps?q=${n.lat},${n.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  📍 Ver ubicación del evento
                </a>
              )}

              {n.estado !== 'RESUELTA' && (
                <button
                  onClick={() => { setModalResolver(n); setResolucion('') }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  <CheckCircle2 className="h-4 w-4" /> Marcar como resuelta
                </button>
              )}
            </div>
          )
        })}
      </div>

      {novedades.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-300" />
          <p className="font-medium">Sin novedades {filtroEstado === 'ABIERTA' ? 'abiertas' : filtroEstado.toLowerCase()}</p>
        </div>
      )}

      {/* Modal resolver */}
      {modalResolver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Resolver novedad</h2>
            <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p><span className="font-medium">Tipo:</span> {TIPO_NOVEDAD_LABELS[modalResolver.tipo]?.label}</p>
              <p><span className="font-medium">Descripción:</span> {modalResolver.descripcion}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Resolución *</label>
              <textarea value={resolucion}
                onChange={e => setResolucion(e.target.value)}
                placeholder="Describe cómo se resolvió la novedad..."
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModalResolver(null)} className="flex-1 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button onClick={handleResolver} disabled={cargando || !resolucion}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {cargando ? 'Guardando...' : 'Resolver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
