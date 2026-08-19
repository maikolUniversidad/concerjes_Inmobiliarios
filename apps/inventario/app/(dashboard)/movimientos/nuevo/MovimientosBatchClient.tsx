'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Loader2, Save, Plus, Trash2, RotateCcw, ArrowDownToLine } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { registrarMovimientos } from '../actions'
import { ProductoCombo, type ProductoComboItem } from '@/components/ui/ProductoCombo'
import type { TipoMovimiento } from '@/lib/types/database'

const TIPOS: { value: TipoMovimiento; label: string }[] = [
  { value: 'ENTRADA', label: 'Entrada' },
  { value: 'SALIDA', label: 'Salida' },
  { value: 'DEVOLUCION', label: 'Devolución' },
  { value: 'AJUSTE', label: 'Ajuste' },
  { value: 'TRASLADO', label: 'Traslado' },
]
const TIPO_HINT: Record<string, string> = {
  ENTRADA: 'Suma al stock', SALIDA: 'Resta del stock', DEVOLUCION: 'Suma (retorno de sede)',
  AJUSTE: 'Fija el stock al valor', TRASLADO: 'No altera el stock central',
}

interface Fila {
  key: number
  tipo: TipoMovimiento
  producto_id: string
  cantidad: string
  sede_id: string
  ubicacion_id: string
  observacion: string
}
interface OrdenOpt { id: string; numero: string; sede_id: string | null; sede_nombre: string | null }

const cellSel = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 font-body text-sm outline-none focus:border-brand-green bg-white'
const cellInp = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 font-body text-sm outline-none focus:border-brand-green'

let uid = 1
const nuevaFila = (tipo: TipoMovimiento = 'ENTRADA', patch: Partial<Fila> = {}): Fila =>
  ({ key: uid++, tipo, producto_id: '', cantidad: '', sede_id: '', ubicacion_id: '', observacion: '', ...patch })

export function MovimientosBatchClient({
  productos, sedes, ubicaciones = [], ordenes = [], initialProducto, initialTipo,
}: {
  productos: ProductoComboItem[]
  sedes: { id: string; nombre: string }[]
  ubicaciones?: { id: string; label: string }[]
  ordenes?: OrdenOpt[]
  initialProducto?: string
  initialTipo?: TipoMovimiento
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [filas, setFilas] = useState<Fila[]>([nuevaFila(initialTipo ?? 'ENTRADA', initialProducto ? { producto_id: initialProducto } : {})])
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ordenSel, setOrdenSel] = useState('')
  const [cargandoOrden, setCargandoOrden] = useState(false)

  function set(key: number, patch: Partial<Fila>) {
    setFilas(fs => fs.map(f => f.key === key ? { ...f, ...patch } : f))
  }
  function addFila() { setFilas(fs => [...fs, nuevaFila()]) }
  function quitar(key: number) { setFilas(fs => fs.length > 1 ? fs.filter(f => f.key !== key) : fs) }

  /** Devolución: trae los ítems de una orden de insumo como filas DEVOLUCION. */
  async function traerOrden() {
    if (!ordenSel) { toast.error('Elige una orden.'); return }
    const orden = ordenes.find(o => o.id === ordenSel)
    setCargandoOrden(true)
    try {
      const { data } = await sb.from('orden_insumo_items')
        .select('producto_id, cantidad_solicitada, cantidad_alistada, producto:productos ( nombre_estandar )')
        .eq('orden_id', ordenSel)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = ((data ?? []) as any[]).filter(r => r.producto_id)
      if (items.length === 0) { toast.error('Esa orden no tiene ítems.'); return }
      const nuevas = items.map(r => nuevaFila('DEVOLUCION', {
        producto_id: r.producto_id,
        cantidad: String(Number(r.cantidad_alistada) || Number(r.cantidad_solicitada) || ''),
        sede_id: orden?.sede_id ?? '',
        observacion: `Devolución de ${orden?.numero ?? 'orden'}`,
      }))
      // Reemplaza filas vacías iniciales; si ya hay datos, agrega.
      setFilas(fs => {
        const conDatos = fs.filter(f => f.producto_id || f.cantidad)
        return [...conDatos, ...nuevas]
      })
      toast.success(`${items.length} ítem(s) de ${orden?.numero ?? 'la orden'} cargados como devolución.`)
      setOrdenSel('')
    } finally { setCargandoOrden(false) }
  }

  function registrar() {
    setError(null)
    const payload = filas
      .filter(f => f.producto_id && Number(f.cantidad) > 0)
      .map(f => ({
        tipo: f.tipo, producto_id: f.producto_id, cantidad: Number(f.cantidad),
        sede_id: f.sede_id || null, ubicacion_id: f.ubicacion_id || null,
        observacion: f.observacion.trim() || null,
      }))
    if (payload.length === 0) { setError('Agrega al menos una fila con producto y cantidad.'); return }
    start(async () => {
      const r = await registrarMovimientos(payload)
      if (r.error) { setError(r.error); return }
      toast.success(`${r.ok} movimiento(s) registrado(s).`)
      router.push('/movimientos')
    })
  }

  const validas = filas.filter(f => f.producto_id && Number(f.cantidad) > 0).length

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Devolución desde una orden */}
      {ordenes.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="flex items-center gap-1.5 font-body font-semibold text-sm text-gray-700">
            <RotateCcw className="w-4 h-4 text-brand-green" /> Devolución desde una orden
          </p>
          <p className="font-body text-xs text-gray-400 mt-0.5 mb-2">Elige una orden de insumo y se cargan sus ítems como filas de devolución.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={ordenSel} onChange={e => setOrdenSel(e.target.value)} className={cellSel + ' max-w-md'}>
              <option value="">— Selecciona una orden —</option>
              {ordenes.map(o => <option key={o.id} value={o.id}>{o.numero}{o.sede_nombre ? ` · ${o.sede_nombre}` : ''}</option>)}
            </select>
            <button onClick={traerOrden} disabled={!ordenSel || cargandoOrden}
              className="flex items-center gap-1.5 border border-brand-green text-brand-green font-body font-semibold text-xs px-3 py-2 rounded-lg hover:bg-green-50 disabled:opacity-50">
              {cargandoOrden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5" />} Traer ítems
            </button>
          </div>
        </div>
      )}

      {/* Tabla de movimientos */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-36">Tipo</th>
                <th className="font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 min-w-[240px]">Producto</th>
                <th className="font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-24 text-center">Cantidad</th>
                <th className="font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-40">Sede</th>
                {ubicaciones.length > 0 && <th className="font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-44">Ubicación</th>}
                <th className="font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 min-w-[160px]">Observación</th>
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filas.map(f => (
                <tr key={f.key} className="align-top">
                  <td className="px-3 py-2">
                    <select value={f.tipo} onChange={e => set(f.key, { tipo: e.target.value as TipoMovimiento })} className={cellSel}>
                      {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <p className="mt-0.5 font-body text-[10px] text-gray-400">{TIPO_HINT[f.tipo]}</p>
                  </td>
                  <td className="px-3 py-2">
                    <ProductoCombo productos={productos} value={f.producto_id}
                      onPick={p => set(f.key, { producto_id: p.id })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min="0" step="0.01" value={f.cantidad}
                      onChange={e => set(f.key, { cantidad: e.target.value })} placeholder="0"
                      className={cellInp + ' text-center'} />
                  </td>
                  <td className="px-3 py-2">
                    <select value={f.sede_id} onChange={e => set(f.key, { sede_id: e.target.value })} className={cellSel}>
                      <option value="">— Sin sede —</option>
                      {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </td>
                  {ubicaciones.length > 0 && (
                    <td className="px-3 py-2">
                      <select value={f.ubicacion_id} onChange={e => set(f.key, { ubicacion_id: e.target.value })} className={cellSel}>
                        <option value="">— Sin ubicación —</option>
                        {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <input value={f.observacion} onChange={e => set(f.key, { observacion: e.target.value })}
                      placeholder="Opcional" className={cellInp} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => quitar(f.key)} title="Quitar fila"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-3">
          <button onClick={addFila} className="flex items-center gap-1.5 border border-brand-green text-brand-green font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-green-50">
            <Plus className="w-3.5 h-3.5" /> Agregar fila
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={registrar} disabled={pending || validas === 0}
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-50">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Registrar movimientos ({validas})
        </button>
        <Link href="/movimientos" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>
    </div>
  )
}
