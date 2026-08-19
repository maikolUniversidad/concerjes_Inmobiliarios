'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Loader2, Save, Plus, Trash2, RotateCcw, ArrowDownToLine, FileStack, Users, X, Check, PlayCircle, Search } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { registrarMovimientos, guardarBorrador, eliminarBorrador, registrarDesdeBorrador } from '../actions'
import { ProductoCombo, type ProductoComboItem } from '@/components/ui/ProductoCombo'
import type { TipoMovimiento } from '@/lib/types/database'

export interface BorradorItem { tipo: TipoMovimiento; producto_id: string | null; cantidad: number | null; sede_id: string | null; ubicacion_id: string | null; observacion: string | null; orden: number }
export interface Borrador { id: string; nombre: string | null; created_at: string; items: BorradorItem[]; responsableIds: string[] }
export interface UsuarioOpt { id: string; nombre: string }

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
  productos, sedes, ubicaciones = [], ordenes = [], usuarios = [], borradores = [], initialProducto, initialTipo,
}: {
  productos: ProductoComboItem[]
  sedes: { id: string; nombre: string }[]
  ubicaciones?: { id: string; label: string }[]
  ordenes?: OrdenOpt[]
  usuarios?: UsuarioOpt[]
  borradores?: Borrador[]
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
  // Borradores
  const [borradorId, setBorradorId] = useState<string | null>(null)
  const [modalBorr, setModalBorr] = useState(false)
  const [nombreBorr, setNombreBorr] = useState('')
  const [respSel, setRespSel] = useState<string[]>([])
  const [respBuscar, setRespBuscar] = useState('')
  const usuariosMap = useMemo(() => new Map(usuarios.map(u => [u.id, u.nombre])), [usuarios])

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

  // ── Borradores ──
  function payloadActual() {
    return filas
      .filter(f => f.producto_id && Number(f.cantidad) > 0)
      .map(f => ({
        tipo: f.tipo, producto_id: f.producto_id, cantidad: Number(f.cantidad),
        sede_id: f.sede_id || null, ubicacion_id: f.ubicacion_id || null, observacion: f.observacion.trim() || null,
      }))
  }
  function cargarBorrador(b: Borrador) {
    const fs = [...b.items].sort((a, z) => a.orden - z.orden).map(it => nuevaFila(it.tipo, {
      producto_id: it.producto_id ?? '', cantidad: it.cantidad != null ? String(it.cantidad) : '',
      sede_id: it.sede_id ?? '', ubicacion_id: it.ubicacion_id ?? '', observacion: it.observacion ?? '',
    }))
    setFilas(fs.length ? fs : [nuevaFila()])
    setBorradorId(b.id); setNombreBorr(b.nombre ?? ''); setRespSel(b.responsableIds)
    toast.message(`Borrador «${b.nombre || 'sin nombre'}» cargado. Ajusta y registra o vuelve a guardar.`)
  }
  function aplicarBorrador(b: Borrador) {
    if (!window.confirm(`¿Registrar los ${b.items.length} movimiento(s) del borrador «${b.nombre || 'sin nombre'}»?`)) return
    start(async () => {
      const r = await registrarDesdeBorrador(b.id)
      if (r.error) { toast.error(r.error); return }
      toast.success(`${r.ok} movimiento(s) registrado(s).`); router.refresh()
    })
  }
  function borrarBorrador(b: Borrador) {
    if (!window.confirm(`¿Eliminar el borrador «${b.nombre || 'sin nombre'}»?`)) return
    start(async () => {
      const r = await eliminarBorrador(b.id)
      if (r.error) { toast.error(r.error); return }
      if (borradorId === b.id) setBorradorId(null)
      toast.success('Borrador eliminado.'); router.refresh()
    })
  }
  function guardarBorr() {
    const items = payloadActual()
    if (items.length === 0) { toast.error('Agrega al menos una fila con producto y cantidad.'); return }
    start(async () => {
      const r = await guardarBorrador({ id: borradorId ?? undefined, nombre: nombreBorr, items, responsables: respSel })
      if (r.error) { toast.error(r.error); return }
      setBorradorId(r.id ?? null); setModalBorr(false)
      toast.success('Borrador guardado.'); router.refresh()
    })
  }
  const usuariosFiltrados = useMemo(() => {
    const q = respBuscar.trim().toLowerCase()
    const base = q ? usuarios.filter(u => u.nombre.toLowerCase().includes(q)) : usuarios
    return base.slice(0, 40)
  }, [usuarios, respBuscar])

  const validas = filas.filter(f => f.producto_id && Number(f.cantidad) > 0).length

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Borradores guardados */}
      {borradores.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="flex items-center gap-1.5 font-body font-semibold text-sm text-gray-700 mb-2">
            <FileStack className="w-4 h-4 text-brand-green" /> Borradores guardados ({borradores.length})
          </p>
          <div className="space-y-2">
            {borradores.map(b => (
              <div key={b.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 flex-wrap ${borradorId === b.id ? 'border-brand-green bg-green-50/40' : 'border-gray-100'}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-medium text-gray-800 truncate">
                    {b.nombre || 'Sin nombre'} <span className="font-normal text-gray-400">· {b.items.length} ítem(s)</span>
                  </p>
                  {b.responsableIds.length > 0 && (
                    <p className="flex items-center gap-1 font-body text-[11px] text-gray-400 truncate">
                      <Users className="w-3 h-3 shrink-0" /> {b.responsableIds.map(id => usuariosMap.get(id) ?? '—').join(', ')}
                    </p>
                  )}
                </div>
                <button onClick={() => cargarBorrador(b)} disabled={pending}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 font-body text-xs font-semibold text-gray-600 hover:border-brand-green hover:text-brand-green disabled:opacity-50">Cargar</button>
                <button onClick={() => aplicarBorrador(b)} disabled={pending}
                  className="flex items-center gap-1 rounded-lg bg-brand-green px-2.5 py-1 font-body text-xs font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
                  <PlayCircle className="w-3.5 h-3.5" /> Registrar
                </button>
                <button onClick={() => borrarBorrador(b)} disabled={pending}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
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

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={registrar} disabled={pending || validas === 0}
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-50">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Registrar movimientos ({validas})
        </button>
        <button onClick={() => setModalBorr(true)} disabled={pending}
          className="flex items-center gap-2 border border-gray-200 text-gray-700 font-body font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <FileStack className="w-4 h-4" /> {borradorId ? 'Actualizar borrador' : 'Guardar como borrador'}
        </button>
        <Link href="/movimientos" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>

      {/* Modal guardar borrador */}
      {modalBorr && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setModalBorr(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-2xl bg-white shadow-2xl sm:inset-0 sm:m-auto sm:h-fit sm:rounded-2xl">
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-heading font-bold text-gray-900">{borradorId ? 'Actualizar borrador' : 'Guardar como borrador'}</h2>
                <button onClick={() => setModalBorr(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
              </div>
              <div>
                <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Nombre del borrador</label>
                <input value={nombreBorr} onChange={e => setNombreBorr(e.target.value)} placeholder="Ej: Recepción bodega lunes"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
              </div>
              <div>
                <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Responsables</label>
                {respSel.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {respSel.map(id => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-green/10 text-brand-green px-2 py-0.5 font-body text-[11px] font-medium">
                        {usuariosMap.get(id) ?? '—'}
                        <button onClick={() => setRespSel(s => s.filter(x => x !== id))}><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <input value={respBuscar} onChange={e => setRespBuscar(e.target.value)} placeholder="Buscar persona…"
                    className="flex-1 bg-transparent font-body text-sm outline-none" />
                </div>
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                  {usuariosFiltrados.map(u => {
                    const on = respSel.includes(u.id)
                    return (
                      <button key={u.id} onClick={() => setRespSel(s => on ? s.filter(x => x !== u.id) : [...s, u.id])}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-green-50">
                        <span className="font-body text-sm text-gray-700 truncate">{u.nombre}</span>
                        {on && <Check className="w-4 h-4 text-brand-green shrink-0" />}
                      </button>
                    )
                  })}
                  {usuariosFiltrados.length === 0 && <p className="px-3 py-2 font-body text-xs text-gray-400">Sin resultados.</p>}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => setModalBorr(false)} className="font-body text-sm text-gray-500 px-3 py-2">Cancelar</button>
                <button onClick={guardarBorr} disabled={pending}
                  className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
