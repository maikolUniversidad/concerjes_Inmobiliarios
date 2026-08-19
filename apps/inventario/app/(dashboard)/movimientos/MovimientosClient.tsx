'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Settings2, ArrowLeftRight,
  Search, X, List, LayoutGrid, Trash2, Loader2, MapPin, Calendar, User2,
} from 'lucide-react'
import { toast } from 'sonner'
import { eliminarMovimiento } from './actions'
import { formatFechaHora } from '@/lib/utils'
import type { TipoMovimiento } from '@/lib/types/database'

export interface MovRow {
  id: string
  tipo: TipoMovimiento
  cantidad: number
  observacion: string | null
  created_at: string
  usuario_id?: string | null
  /** Quién registró el movimiento (resuelto en el servidor). */
  responsable?: string | null
  producto: { nombre_estandar: string; presentacion: string | null } | null
  sede: { nombre: string } | null
}

const TIPO_META: Record<TipoMovimiento, { label: string; cls: string; icon: typeof ArrowDownToLine }> = {
  ENTRADA: { label: 'Entrada', cls: 'bg-green-100 text-green-700', icon: ArrowDownToLine },
  SALIDA: { label: 'Salida', cls: 'bg-orange-100 text-orange-700', icon: ArrowUpFromLine },
  DEVOLUCION: { label: 'Devolución', cls: 'bg-blue-100 text-blue-700', icon: RefreshCw },
  AJUSTE: { label: 'Ajuste', cls: 'bg-purple-100 text-purple-700', icon: Settings2 },
  TRASLADO: { label: 'Traslado', cls: 'bg-gray-100 text-gray-600', icon: ArrowLeftRight },
}
const ORDEN_TIPOS: TipoMovimiento[] = ['ENTRADA', 'SALIDA', 'DEVOLUCION', 'AJUSTE', 'TRASLADO']

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

type Vista = 'tarjetas' | 'tabla'

export function MovimientosClient({ movs, puedeEliminar }: { movs: MovRow[]; puedeEliminar: boolean }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState<TipoMovimiento | 'TODOS'>('TODOS')
  const [borrando, setBorrando] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Tarjetas en móvil, tabla en pantallas grandes; el usuario puede cambiarlo.
  const [vista, setVista] = useState<Vista>('tarjetas')
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) setVista('tabla')
  }, [])

  const conteos = useMemo(() => {
    const c: Record<string, number> = { TODOS: movs.length }
    for (const m of movs) c[m.tipo] = (c[m.tipo] ?? 0) + 1
    return c
  }, [movs])

  const filtrados = useMemo(() => {
    const tokens = norm(q).split(/\s+/).filter(Boolean)
    return movs.filter(m => {
      if (tipo !== 'TODOS' && m.tipo !== tipo) return false
      if (tokens.length === 0) return true
      const heno = norm(`${m.producto?.nombre_estandar ?? ''} ${m.producto?.presentacion ?? ''} ${m.sede?.nombre ?? ''} ${m.observacion ?? ''} ${m.responsable ?? ''} ${TIPO_META[m.tipo].label}`)
      return tokens.every(t => heno.includes(t))
    })
  }, [movs, q, tipo])

  function borrar(m: MovRow) {
    const nombre = m.producto?.nombre_estandar ?? 'el producto'
    const efecto = m.tipo === 'AJUSTE'
      ? 'El ajuste fijaba el stock a un valor absoluto, así que NO se puede revertir solo: revisa el stock después.'
      : m.tipo === 'TRASLADO'
        ? 'El traslado no altera el stock central.'
        : `Se revertirá su efecto en el stock de ${nombre}.`
    if (!window.confirm(`¿Eliminar este movimiento (${TIPO_META[m.tipo].label} de ${m.cantidad} · ${nombre})?\n\n${efecto}`)) return
    setBorrando(m.id)
    start(async () => {
      const r = await eliminarMovimiento(m.id, true)
      setBorrando(null)
      if (r.error) { toast.error(r.error); return }
      toast.success(r.mensaje ?? 'Movimiento eliminado.')
      router.refresh()
    })
  }

  const chip = (key: TipoMovimiento | 'TODOS', label: string) => {
    const activo = tipo === key
    const n = conteos[key] ?? 0
    if (key !== 'TODOS' && n === 0) return null
    return (
      <button key={key} onClick={() => setTipo(key)}
        className={'rounded-full px-3 py-1.5 font-body text-xs font-semibold transition-colors ' +
          (activo ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
        {label} <span className={activo ? 'text-white/80' : 'text-gray-400'}>({n})</span>
      </button>
    )
  }

  const btnBorrar = (m: MovRow, compacto = false) => puedeEliminar && (
    <button onClick={() => borrar(m)} disabled={pending && borrando === m.id}
      title="Eliminar movimiento (revierte el stock)"
      className={`rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 ${compacto ? 'p-1.5' : 'p-2'}`}>
      {borrando === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Buscador + vista */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por producto, sede, responsable u observación…"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-9 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20" />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-white p-0.5">
          <button onClick={() => setVista('tabla')} title="Ver como tabla"
            className={'rounded-lg p-2 ' + (vista === 'tabla' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-100')}>
            <List className="h-4 w-4" />
          </button>
          <button onClick={() => setVista('tarjetas')} title="Ver como tarjetas"
            className={'rounded-lg p-2 ' + (vista === 'tarjetas' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-100')}>
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filtros por tipo */}
      <div className="flex flex-wrap gap-2">
        {chip('TODOS', 'Todos')}
        {ORDEN_TIPOS.map(t => chip(t, TIPO_META[t].label))}
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center text-gray-400">
          <ArrowLeftRight className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="font-heading text-lg font-bold text-gray-600">Sin resultados</p>
          <p className="mt-1 font-body text-sm">
            {q || tipo !== 'TODOS' ? 'Ningún movimiento coincide con el filtro.' : 'Aún no hay movimientos.'}
          </p>
        </div>
      ) : vista === 'tarjetas' ? (
        /* ── Tarjetas ── */
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtrados.map(m => {
            const meta = TIPO_META[m.tipo]
            const Icon = meta.icon
            return (
              <div key={m.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 font-body font-medium text-xs px-2.5 py-1 rounded-full ${meta.cls}`}>
                    <Icon className="w-3.5 h-3.5" /> {meta.label}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="font-heading font-bold text-xl text-gray-900">{m.cantidad}</span>
                    {btnBorrar(m, true)}
                  </div>
                </div>
                <p className="mt-2 font-body font-medium text-sm text-gray-900 break-words">
                  {m.producto?.nombre_estandar ?? '—'}
                </p>
                {m.producto?.presentacion && (
                  <p className="font-body text-xs text-gray-400">{m.producto.presentacion}</p>
                )}
                <div className="mt-2 space-y-1">
                  <p className="flex items-center gap-1.5 font-body text-xs text-gray-500">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-300" /> {m.sede?.nombre ?? 'Sin sede'}
                  </p>
                  <p className="flex items-center gap-1.5 font-body text-xs text-gray-500">
                    <User2 className="w-3.5 h-3.5 shrink-0 text-gray-300" />
                    <span className="truncate">{m.responsable ?? 'Sin responsable'}</span>
                  </p>
                  <p className="flex items-center gap-1.5 font-body text-xs text-gray-400">
                    <Calendar className="w-3.5 h-3.5 shrink-0 text-gray-300" /> {formatFechaHora(m.created_at)}
                  </p>
                </div>
                {m.observacion && (
                  <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5 font-body text-xs text-gray-600 break-words">
                    {m.observacion}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Tabla ── */
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Tipo</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Producto</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Sede</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Cantidad</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Observación</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Responsable</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Fecha</th>
                  {puedeEliminar && <th className="w-12 px-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.map(m => {
                  const meta = TIPO_META[m.tipo]
                  const Icon = meta.icon
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-body font-medium text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${meta.cls}`}>
                          <Icon className="w-3.5 h-3.5" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-body font-medium text-sm text-gray-900">{m.producto?.nombre_estandar ?? '—'}</p>
                        <p className="font-body text-xs text-gray-400">{m.producto?.presentacion}</p>
                      </td>
                      <td className="px-4 py-3 font-body text-sm text-gray-500">{m.sede?.nombre ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-heading font-bold text-base text-gray-900">{m.cantidad}</td>
                      <td className="px-4 py-3 font-body text-sm text-gray-500 max-w-[260px] truncate">{m.observacion ?? '—'}</td>
                      <td className="px-4 py-3">
                        {m.responsable ? (
                          <span className="flex items-center gap-1.5 font-body text-sm text-gray-600">
                            <User2 className="w-3.5 h-3.5 shrink-0 text-gray-300" />
                            <span className="max-w-[160px] truncate">{m.responsable}</span>
                          </span>
                        ) : <span className="font-body text-sm text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-body text-xs text-gray-400 whitespace-nowrap">
                        {formatFechaHora(m.created_at)}
                      </td>
                      {puedeEliminar && <td className="px-2 py-3 text-center">{btnBorrar(m, true)}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="font-body text-xs text-gray-400">
        {filtrados.length === movs.length
          ? `${movs.length} movimiento(s)`
          : `${filtrados.length} de ${movs.length} movimiento(s)`}
      </p>
    </div>
  )
}
