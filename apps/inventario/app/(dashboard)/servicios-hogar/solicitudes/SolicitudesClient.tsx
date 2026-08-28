'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Phone, Mail, MapPin, Clock, RefreshCw, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { updateEstadoSolicitud } from '../actions'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

const ESTADOS = [
  { value: 'TODOS',       label: 'Todas' },
  { value: 'PENDIENTE',   label: 'Pendientes' },
  { value: 'CONFIRMADA',  label: 'Confirmadas' },
  { value: 'EN_SERVICIO', label: 'En servicio' },
  { value: 'COMPLETADA',  label: 'Completadas' },
  { value: 'CANCELADA',   label: 'Canceladas' },
]

const EST_CLS: Record<string, string> = {
  PENDIENTE:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  CONFIRMADA:  'bg-blue-100 text-blue-700 border-blue-200',
  EN_SERVICIO: 'bg-purple-100 text-purple-700 border-purple-200',
  COMPLETADA:  'bg-green-100 text-green-700 border-green-200',
  CANCELADA:   'bg-red-100 text-red-700 border-red-200',
}

const SIGUIENTES: Record<string, { value: string; label: string; cls: string }[]> = {
  PENDIENTE:   [{ value: 'CONFIRMADA', label: 'Confirmar', cls: 'bg-blue-600 text-white' }, { value: 'CANCELADA', label: 'Cancelar', cls: 'bg-red-100 text-red-700' }],
  CONFIRMADA:  [{ value: 'EN_SERVICIO', label: 'Iniciar servicio', cls: 'bg-purple-600 text-white' }, { value: 'CANCELADA', label: 'Cancelar', cls: 'bg-red-100 text-red-700' }],
  EN_SERVICIO: [{ value: 'COMPLETADA', label: 'Marcar completada', cls: 'bg-green-600 text-white' }],
}

interface Props {
  solicitudes: any[]
  total: number
  page: number
  pageSize: number
}

export default function SolicitudesClient({ solicitudes, total, page, pageSize }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [isPending, startTransition] = useTransition()

  function navegar(updates: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    Object.entries(updates).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k) })
    startTransition(() => router.push(`?${p.toString()}`))
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    navegar({ search, page: '1' })
  }

  async function cambiarEstado(id: string, estado: string) {
    let motivo: string | undefined
    if (estado === 'CANCELADA') {
      motivo = prompt('Motivo de cancelación (opcional):') ?? undefined
    }
    await updateEstadoSolicitud(id, estado, motivo)
    startTransition(() => router.refresh())
  }

  const totalPages = Math.ceil(total / pageSize)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const columnas: ColumnaTabla<any>[] = [
    { id: 'numero', header: '#', valor: s => s.numero ?? '', ancho: 'w-24', className: 'font-mono text-xs text-gray-500', tarjeta: 'meta' },
    {
      id: 'cliente', header: 'Cliente', valor: s => s.cliente_nombre ?? '', ancho: 'min-w-[220px]', tarjeta: 'titulo',
      celda: s => (
        <>
          <p className="font-semibold text-gray-900">{s.cliente_nombre}</p>
          <div className="flex items-center gap-3 mt-0.5">
            <a href={`tel:${s.cliente_telefono}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-green">
              <Phone className="w-3 h-3" />{s.cliente_telefono}
            </a>
            <a href={`mailto:${s.cliente_email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-green">
              <Mail className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
            <MapPin className="w-3 h-3" />{s.cliente_direccion}, {s.cliente_ciudad}
          </div>
        </>
      ),
    },
    { id: 'telefono', header: 'Teléfono', valor: s => s.cliente_telefono ?? '', prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'oculto' },
    { id: 'email', header: 'Correo', valor: s => s.cliente_email ?? '', prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'oculto' },
    { id: 'ciudad', header: 'Ciudad', valor: s => s.cliente_ciudad ?? '', prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'oculto' },
    {
      id: 'servicio', header: 'Servicio', valor: s => s.tipos_servicio_hogar?.nombre ?? '', prioridad: 2, tarjeta: 'subtitulo',
      celda: s => (
        <>
          <div className="flex items-center gap-1.5">
            <span>{s.tipos_servicio_hogar?.icono}</span>
            <span className="font-medium text-gray-800">{s.tipos_servicio_hogar?.nombre ?? '—'}</span>
          </div>
          {s.tarifas_servicio_hogar?.nombre && (
            <p className="text-xs text-gray-400 mt-0.5">{s.tarifas_servicio_hogar.nombre}</p>
          )}
          <p className="text-xs text-gray-400">{s.frecuencia}</p>
        </>
      ),
    },
    { id: 'frecuencia', header: 'Frecuencia', valor: s => s.frecuencia ?? '', prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'oculto' },
    {
      id: 'fecha', header: 'Fecha/Hora', prioridad: 2, tarjeta: 'meta',
      valor: s => `${s.fecha_deseada ?? ''} ${s.hora_inicio?.slice(0, 5) ?? ''}`.trim(),
      celda: s => (
        <>
          <div className="flex items-center gap-1 text-gray-700">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />{s.fecha_deseada}
          </div>
          <div className="flex items-center gap-1 text-gray-500 text-xs mt-0.5">
            <Clock className="w-3 h-3" />{s.hora_inicio?.slice(0, 5)}
          </div>
        </>
      ),
    },
    {
      id: 'estado', header: 'Estado', valor: s => s.estado ?? '', align: 'center', tarjeta: 'badge',
      celda: s => (
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${EST_CLS[s.estado] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
          {s.estado}
        </span>
      ),
    },
    { id: 'notas', header: 'Notas', valor: s => s.notas ?? '', prioridad: 3, className: 'text-xs text-gray-400 max-w-[200px] truncate', tarjeta: 'cuerpo' },
  ]

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={buscar} className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email o #solicitud…"
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-green-400" />
          </div>
          <button type="submit" className="px-4 py-2 bg-brand-green text-white rounded-xl text-sm font-medium hover:bg-brand-green-dark transition-colors">
            Buscar
          </button>
        </form>

        <div className="flex gap-2 flex-wrap">
          {ESTADOS.map(e => (
            <button key={e.value} onClick={() => navegar({ estado: e.value, page: '1' })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                (params.get('estado') ?? 'TODOS') === e.value
                  ? 'bg-brand-green text-white border-brand-green'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
              }`}>
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-brand-green" /></div>
      ) : (
        <>
          <TablaEstandar
            id="servicios-solicitudes"
            titulo="Solicitudes de servicio"
            modulo="Servicios del Hogar"
            entidad="solicitudes_servicio_hogar"
            datos={solicitudes}
            columnas={columnas}
            filaId={s => String(s.id)}
            busqueda={false}
            filasPorPagina={0}
            anchoAcciones="w-48"
            acciones={s => (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {(SIGUIENTES[s.estado] ?? []).map((acc) => (
                  <button key={acc.value} onClick={() => cambiarEstado(s.id, acc.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 ${acc.cls}`}>
                    {acc.label}
                  </button>
                ))}
              </div>
            )}
            vacio={<p className="text-sm text-gray-400">No hay solicitudes con estos filtros.</p>}
          />

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">{total} solicitudes · página {page} de {totalPages}</p>
              <div className="flex gap-2">
                <button onClick={() => navegar({ page: String(page - 1) })} disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft className="w-4 h-4 text-gray-600" />
                </button>
                <button onClick={() => navegar({ page: String(page + 1) })} disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
