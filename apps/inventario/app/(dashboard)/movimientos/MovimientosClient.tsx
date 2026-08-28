'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Settings2, ArrowLeftRight,
  Trash2, Loader2, MapPin, Calendar, User2,
} from 'lucide-react'
import { toast } from 'sonner'
import { eliminarMovimiento } from './actions'
import { formatFechaHora } from '@/lib/utils'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
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
  producto: { ref: number | null; codigo: number | null; nombre_estandar: string; presentacion: string | null } | null
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

export function MovimientosClient({ movs, puedeEliminar }: { movs: MovRow[]; puedeEliminar: boolean }) {
  const router = useRouter()
  const [tipo, setTipo] = useState<TipoMovimiento | 'TODOS'>('TODOS')
  const [borrando, setBorrando] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const conteos = useMemo(() => {
    const c: Record<string, number> = { TODOS: movs.length }
    for (const m of movs) c[m.tipo] = (c[m.tipo] ?? 0) + 1
    return c
  }, [movs])

  const filtrados = useMemo(
    () => (tipo === 'TODOS' ? movs : movs.filter((m) => m.tipo === tipo)),
    [movs, tipo]
  )

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

  const btnBorrar = (m: MovRow) => puedeEliminar && (
    <button onClick={() => borrar(m)} disabled={pending && borrando === m.id}
      title="Eliminar movimiento (revierte el stock)"
      className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
      {borrando === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  )

  /** Identificador visible del producto: REF y, si no hay, el código. */
  const refProducto = (m: MovRow) => m.producto?.ref ?? m.producto?.codigo ?? null

  const columnas: ColumnaTabla<MovRow>[] = [
    {
      id: 'ref',
      header: 'REF',
      valor: (m) => refProducto(m) ?? '',
      ancho: 'w-20',
      celda: (m) => {
        const ref = refProducto(m)
        return ref === null
          ? <span className="font-body text-xs text-gray-300">—</span>
          : <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">{ref}</span>
      },
      tarjeta: 'meta',
    },
    {
      id: 'tipo',
      header: 'Tipo',
      valor: (m) => TIPO_META[m.tipo].label,
      celda: (m) => {
        const meta = TIPO_META[m.tipo]
        const Icon = meta.icon
        return (
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-body text-xs font-medium ${meta.cls}`}>
            <Icon className="h-3.5 w-3.5" /> {meta.label}
          </span>
        )
      },
      tarjeta: 'badge',
    },
    {
      id: 'producto',
      header: 'Producto',
      valor: (m) => m.producto?.nombre_estandar ?? '',
      celda: (m) => (
        <>
          <p className="font-body text-sm font-medium text-gray-900">{m.producto?.nombre_estandar ?? '—'}</p>
          <p className="font-body text-xs text-gray-400">{m.producto?.presentacion}</p>
        </>
      ),
      ancho: 'min-w-[200px]',
      tarjeta: 'titulo',
    },
    {
      id: 'presentacion',
      header: 'Presentación',
      valor: (m) => m.producto?.presentacion ?? '',
      prioridad: 3,
      tarjeta: 'oculto',
      className: 'text-xs text-gray-400',
    },
    {
      id: 'sede',
      header: 'Sede',
      valor: (m) => m.sede?.nombre ?? '',
      className: 'text-gray-500',
      prioridad: 2,
      tarjeta: 'meta',
    },
    {
      id: 'cantidad',
      header: 'Cantidad',
      valor: (m) => m.cantidad,
      align: 'right',
      celda: (m) => <span className="font-heading text-base font-bold text-gray-900">{m.cantidad}</span>,
      tarjeta: 'meta',
    },
    {
      id: 'observacion',
      header: 'Observación',
      valor: (m) => m.observacion ?? '',
      prioridad: 3,
      className: 'max-w-[260px] truncate text-gray-500',
      tarjeta: 'cuerpo',
    },
    {
      id: 'responsable',
      header: 'Responsable',
      valor: (m) => m.responsable ?? '',
      prioridad: 2,
      celda: (m) =>
        m.responsable ? (
          <span className="flex items-center gap-1.5 font-body text-sm text-gray-600">
            <User2 className="h-3.5 w-3.5 shrink-0 text-gray-300" />
            <span className="max-w-[160px] truncate">{m.responsable}</span>
          </span>
        ) : (
          <span className="font-body text-sm text-gray-300">—</span>
        ),
      tarjeta: 'meta',
    },
    {
      id: 'fecha',
      header: 'Fecha',
      valor: (m) => formatFechaHora(m.created_at),
      align: 'right',
      prioridad: 2,
      className: 'whitespace-nowrap text-xs text-gray-400',
      tarjeta: 'meta',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Filtros por tipo */}
      <div className="flex flex-wrap gap-2">
        {chip('TODOS', 'Todos')}
        {ORDEN_TIPOS.map(t => chip(t, TIPO_META[t].label))}
      </div>

      <TablaEstandar
        id="movimientos"
        titulo="Movimientos"
        modulo="Inventario"
        entidad="movimientos"
        datos={filtrados}
        columnas={columnas}
        filaId={(m) => m.id}
        busqueda="Buscar por REF, producto, sede, responsable u observación…"
        acciones={puedeEliminar ? (m) => btnBorrar(m) : undefined}
        anchoAcciones="w-12"
        vacio={
          <>
            <ArrowLeftRight className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="font-heading text-lg font-bold text-gray-600">Sin resultados</p>
            <p className="mt-1 font-body text-sm text-gray-400">
              {tipo !== 'TODOS' ? 'Ningún movimiento coincide con el filtro.' : 'Aún no hay movimientos.'}
            </p>
          </>
        }
        renderTarjeta={(m) => {
          const meta = TIPO_META[m.tipo]
          const Icon = meta.icon
          return (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-xs font-medium ${meta.cls}`}>
                  <Icon className="h-3.5 w-3.5" /> {meta.label}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="font-heading text-xl font-bold text-gray-900">{m.cantidad}</span>
                  {btnBorrar(m)}
                </div>
              </div>
              <p className="mt-2 break-words font-body text-sm font-medium text-gray-900">
                {m.producto?.nombre_estandar ?? '—'}
              </p>
              {refProducto(m) !== null && (
                <p className="mt-1 font-mono text-xs text-gray-400">REF {refProducto(m)}</p>
              )}
              {m.producto?.presentacion && (
                <p className="font-body text-xs text-gray-400">{m.producto.presentacion}</p>
              )}
              <div className="mt-2 space-y-1">
                <p className="flex items-center gap-1.5 font-body text-xs text-gray-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-300" /> {m.sede?.nombre ?? 'Sin sede'}
                </p>
                <p className="flex items-center gap-1.5 font-body text-xs text-gray-500">
                  <User2 className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                  <span className="truncate">{m.responsable ?? 'Sin responsable'}</span>
                </p>
                <p className="flex items-center gap-1.5 font-body text-xs text-gray-400">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-300" /> {formatFechaHora(m.created_at)}
                </p>
              </div>
              {m.observacion && (
                <p className="mt-2 break-words rounded-lg bg-gray-50 px-2.5 py-1.5 font-body text-xs text-gray-600">
                  {m.observacion}
                </p>
              )}
            </>
          )
        }}
      />
    </div>
  )
}
