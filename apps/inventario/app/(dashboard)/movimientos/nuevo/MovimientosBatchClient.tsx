'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Loader2, Save, Plus, Trash2, RotateCcw, ArrowDownToLine, FileStack, Users, X, Check, PlayCircle, Search, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { registrarMovimientos, guardarBorrador, eliminarBorrador, registrarDesdeBorrador } from '../actions'
import { ProductoCombo, type ProductoComboItem } from '@/components/ui/ProductoCombo'
import { ComboBuscador } from '@/components/ui/ComboBuscador'
import type { TipoMovimiento } from '@/lib/types/database'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

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
interface OrdenOpt {
  id: string; numero: string; sede_id: string | null; sede_nombre: string | null
  estado?: string; created_at?: string
}

const ESTADO_ORDEN: Record<string, string> = {
  BORRADOR: 'Borrador', EN_REVISION: 'En revisión', CAMBIOS_SOLICITADOS: 'Cambios solicitados',
  APROBADA: 'Aprobada', PENDIENTE: 'Pendiente', EN_ALISTAMIENTO: 'En alistamiento', ALISTADO: 'Alistado',
  DESPACHADO: 'Despachado', EN_RUTA: 'En ruta', ENTREGADO: 'Entregado', RECIBIDO: 'Recibido',
}
const fechaCorta = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : ''

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

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
  // Acordeón de tarjetas: solo una expandida a la vez (la que se está editando).
  const [abierta, setAbierta] = useState<number | null>(filas[0]?.key ?? null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // La devolución desde una orden va plegada: solo se abre si van a devolver.
  const [modoDevolucion, setModoDevolucion] = useState(false)
  const [ordenSel, setOrdenSel] = useState('')
  const [cargandoOrden, setCargandoOrden] = useState(false)
  // Borradores
  const [borradorId, setBorradorId] = useState<string | null>(null)
  const [modalBorr, setModalBorr] = useState(false)
  const [nombreBorr, setNombreBorr] = useState('')
  const [respSel, setRespSel] = useState<string[]>([])
  const [respBuscar, setRespBuscar] = useState('')
  const usuariosMap = useMemo(() => new Map(usuarios.map(u => [u.id, u.nombre])), [usuarios])
  const productosMap = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos])

  function set(key: number, patch: Partial<Fila>) {
    setFilas(fs => fs.map(f => f.key === key ? { ...f, ...patch } : f))
  }
  function addFila() { const nf = nuevaFila(); setFilas(fs => [...fs, nf]); setAbierta(nf.key) }
  function quitar(key: number) {
    if (filas.length <= 1) return
    const rest = filas.filter(f => f.key !== key)
    setFilas(rest)
    if (key === abierta) setAbierta(rest[0]?.key ?? null)
  }

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
      setAbierta(null) // colapsa todas: se ve la lista de productos traídos
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
    setAbierta(null) // colapsa todas al cargar un borrador
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
  // Lista de personas del modal. Sin buscar solo se muestran unas pocas (más los
  // ya elegidos) para que la lista no se coma el alto del modal en el celular.
  const usuariosUnicos = useMemo(() => {
    const vistos = new Set<string>()
    return usuarios.filter(u => (vistos.has(u.id) ? false : (vistos.add(u.id), true)))
  }, [usuarios])

  const usuariosFiltrados = useMemo(() => {
    const q = norm(respBuscar.trim())
    if (q) {
      const tokens = q.split(/\s+/)
      return usuariosUnicos.filter(u => tokens.every(t => norm(u.nombre).includes(t))).slice(0, 40)
    }
    const elegidos = usuariosUnicos.filter(u => respSel.includes(u.id))
    const resto = usuariosUnicos.filter(u => !respSel.includes(u.id)).slice(0, 8)
    return [...elegidos, ...resto]
  }, [usuariosUnicos, respBuscar, respSel])

  const validas = filas.filter(f => f.producto_id && Number(f.cantidad) > 0).length

  // Campos de una fila. Se comparten entre la tabla (escritorio) y las tarjetas
  // (móvil) para que no se desincronicen dos copias del mismo formulario.
  const campoTipo = (f: Fila) => (
    <select value={f.tipo} onChange={e => set(f.key, { tipo: e.target.value as TipoMovimiento })} className={cellSel}>
      {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  )
  const campoProducto = (f: Fila) => (
    <ProductoCombo productos={productos} value={f.producto_id} onPick={p => set(f.key, { producto_id: p.id })} />
  )
  const campoCantidad = (f: Fila) => (
    <input type="number" min="0" step="0.01" inputMode="decimal" value={f.cantidad}
      onChange={e => set(f.key, { cantidad: e.target.value })} placeholder="0"
      className={cellInp + ' text-center'} />
  )
  const campoSede = (f: Fila) => (
    <select value={f.sede_id} onChange={e => set(f.key, { sede_id: e.target.value })} className={cellSel}>
      <option value="">— Sin sede —</option>
      {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
    </select>
  )
  const campoUbicacion = (f: Fila) => (
    <select value={f.ubicacion_id} onChange={e => set(f.key, { ubicacion_id: e.target.value })} className={cellSel}>
      <option value="">— Sin ubicación —</option>
      {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
    </select>
  )
  const campoObservacion = (f: Fila) => (
    <input value={f.observacion} onChange={e => set(f.key, { observacion: e.target.value })}
      placeholder="Opcional" className={cellInp} />
  )
  const btnQuitar = (f: Fila) => (
    <button onClick={() => quitar(f.key)} title="Quitar" disabled={filas.length === 1}
      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400">
      <Trash2 className="w-4 h-4" />
    </button>
  )

  const sedesMap = new Map(sedes.map((x) => [x.id, x.nombre]))
  const ubicMap = new Map(ubicaciones.map((u) => [u.id, u.label]))

  const columnasFilas: ColumnaTabla<Fila>[] = [
    {
      id: 'tipo', header: 'Tipo', ancho: 'w-36', interactiva: true, tarjeta: 'oculto',
      valor: (f) => TIPOS.find((t) => t.value === f.tipo)?.label ?? f.tipo,
      celda: (f) => (
        <>
          {campoTipo(f)}
          <p className="mt-0.5 font-body text-[10px] text-gray-400">{TIPO_HINT[f.tipo]}</p>
        </>
      ),
    },
    {
      id: 'producto', header: 'Producto', ancho: 'min-w-[240px]', interactiva: true, tarjeta: 'oculto',
      valor: (f) => productosMap.get(f.producto_id)?.nombre_estandar ?? '',
      celda: (f) => campoProducto(f),
    },
    {
      id: 'cantidad', header: 'Cantidad', align: 'center', ancho: 'w-24', interactiva: true, tarjeta: 'oculto',
      valor: (f) => Number(f.cantidad) || 0,
      celda: (f) => campoCantidad(f),
    },
    {
      id: 'sede', header: 'Sede', ancho: 'w-40', interactiva: true, tarjeta: 'oculto',
      valor: (f) => sedesMap.get(f.sede_id) ?? '',
      celda: (f) => campoSede(f),
    },
    ...(ubicaciones.length > 0 ? [{
      id: 'ubicacion', header: 'Ubicación', ancho: 'w-44', interactiva: true, tarjeta: 'oculto' as const,
      valor: (f: Fila) => ubicMap.get(f.ubicacion_id) ?? '',
      celda: (f: Fila) => campoUbicacion(f),
    }] : []),
    {
      id: 'observacion', header: 'Observación', ancho: 'min-w-[160px]', interactiva: true, tarjeta: 'oculto',
      valor: (f) => f.observacion,
      celda: (f) => campoObservacion(f),
    },
  ]

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

      {/* Devolución desde una orden — plegada; se abre solo si van a devolver */}
      {ordenes.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
          <button type="button" onClick={() => setModoDevolucion(v => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left">
            <RotateCcw className="w-4 h-4 text-brand-green shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-body font-semibold text-sm text-gray-700">¿Vas a registrar una devolución?</span>
              <span className="block font-body text-xs text-gray-400">
                Trae los ítems de una orden de insumo y los carga como filas de devolución.
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${modoDevolucion ? 'rotate-180' : ''}`} />
          </button>
          {modoDevolucion && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-3">
            <div className="w-full max-w-md">
              <ComboBuscador
                items={ordenes}
                value={ordenSel}
                onPick={o => setOrdenSel(o.id)}
                getId={o => o.id}
                textoBusqueda={o => `${o.numero} ${o.sede_nombre ?? ''} ${ESTADO_ORDEN[o.estado ?? ''] ?? o.estado ?? ''} ${fechaCorta(o.created_at)}`}
                placeholder="— Busca la orden por número o sede —"
                buscarPlaceholder="Número de orden, sede o estado…"
                sinResultados="Ninguna orden coincide"
                etiqueta={o => <span className="truncate">{o.numero}{o.sede_nombre ? ` · ${o.sede_nombre}` : ''}</span>}
                fila={o => (
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-body text-sm font-semibold text-gray-800">{o.numero}</span>
                      {o.estado && (
                        <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {ESTADO_ORDEN[o.estado] ?? o.estado}
                        </span>
                      )}
                    </span>
                    <span className="block font-body text-xs text-gray-400 truncate">
                      {o.sede_nombre ?? 'Sin sede'}{o.created_at ? ` · ${fechaCorta(o.created_at)}` : ''}
                    </span>
                  </span>
                )}
              />
            </div>
            <button onClick={traerOrden} disabled={!ordenSel || cargandoOrden}
              className="flex items-center gap-1.5 border border-brand-green text-brand-green font-body font-semibold text-xs px-3 py-2 rounded-lg hover:bg-green-50 disabled:opacity-50">
              {cargandoOrden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5" />} Traer ítems
            </button>
          </div>
          )}
        </div>
      )}

      {/* Movimientos: tabla o tarjetas, con el estándar del portal */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <span className="font-heading font-semibold text-sm text-gray-900">Movimientos ({filas.length})</span>
        </div>
        <div className="p-4">
          <TablaEstandar
            id="movimientos-lote"
            titulo="Movimientos en lote"
            modulo="Inventario"
            entidad="movimientos"
            datos={filas}
            columnas={columnasFilas}
            filaId={(f) => String(f.key)}
            busqueda={false}
            filasPorPagina={0}
            descargable={false}
            vistaInicial="tarjetas"
            gridTarjetas="divide-y divide-gray-100 rounded-2xl border border-gray-100"
            tarjetaSinMarco
            anchoAcciones="w-10"
            acciones={(f) => btnQuitar(f)}
            vacio={<p className="font-body text-sm text-gray-400">Agrega la primera fila para registrar movimientos.</p>}
            renderTarjeta={(f) => {
              const open = abierta === f.key
              const p = productosMap.get(f.producto_id)
              const resumen = p ? `${p.nombre_estandar}${p.presentacion ? ` · ${p.presentacion}` : ''}` : 'Sin producto'
              const i = filas.indexOf(f)
              return (
                <div>
                  <div className="flex items-center">
                    <button type="button" onClick={() => setAbierta(open ? null : f.key)}
                      className="flex flex-1 items-center gap-2 px-4 py-3 text-left min-w-0">
                      <span className="font-heading font-bold text-sm text-gray-900 shrink-0">Mov. {i + 1}</span>
                      {!open ? (
                        <>
                          <span className={`min-w-0 flex-1 truncate font-body text-sm ${p ? 'text-gray-700' : 'text-gray-400'}`}>{resumen}</span>
                          {Number(f.cantidad) > 0 && (
                            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 font-body text-[11px] font-semibold text-gray-600">
                              {TIPOS.find(t => t.value === f.tipo)?.label} · {f.cantidad}
                            </span>
                          )}
                        </>
                      ) : <span className="flex-1" />}
                      <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    <div className="pr-3 shrink-0">{btnQuitar(f)}</div>
                  </div>
                  {open && (
                    <div className="px-4 pb-4 space-y-3">
                      <div>
                        <label className="font-body font-semibold text-[11px] uppercase text-gray-500 block mb-1">Tipo</label>
                        {campoTipo(f)}
                        <p className="mt-0.5 font-body text-[11px] text-gray-400">{TIPO_HINT[f.tipo]}</p>
                      </div>
                      <div>
                        <label className="font-body font-semibold text-[11px] uppercase text-gray-500 block mb-1">Producto</label>
                        {campoProducto(f)}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="font-body font-semibold text-[11px] uppercase text-gray-500 block mb-1">Cantidad</label>
                          {campoCantidad(f)}
                        </div>
                        <div>
                          <label className="font-body font-semibold text-[11px] uppercase text-gray-500 block mb-1">Sede</label>
                          {campoSede(f)}
                        </div>
                      </div>
                      {ubicaciones.length > 0 && (
                        <div>
                          <label className="font-body font-semibold text-[11px] uppercase text-gray-500 block mb-1">Ubicación</label>
                          {campoUbicacion(f)}
                        </div>
                      )}
                      <div>
                        <label className="font-body font-semibold text-[11px] uppercase text-gray-500 block mb-1">Observación</label>
                        {campoObservacion(f)}
                      </div>
                    </div>
                  )}
                </div>
              )
            }}
          />
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
          {/* Alto acotado + scroll propio: en el celular la lista de personas
              empujaba los botones fuera de la pantalla. */}
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88svh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[85vh] sm:rounded-2xl">
            <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-5 py-4">
              <h2 className="font-heading font-bold text-gray-900">{borradorId ? 'Actualizar borrador' : 'Guardar como borrador'}</h2>
              <button onClick={() => setModalBorr(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                <div className="mt-1 rounded-lg border border-gray-100 divide-y divide-gray-50">
                  {usuariosFiltrados.map(u => {
                    const on = respSel.includes(u.id)
                    return (
                      <button key={u.id} type="button"
                        onClick={() => setRespSel(s => on ? s.filter(x => x !== u.id) : [...s, u.id])}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${on ? 'bg-green-50/60' : 'hover:bg-green-50'}`}>
                        <span className="font-body text-sm text-gray-700 truncate">{u.nombre}</span>
                        {on && <Check className="w-4 h-4 text-brand-green shrink-0" />}
                      </button>
                    )
                  })}
                  {usuariosFiltrados.length === 0 && <p className="px-3 py-2 font-body text-xs text-gray-400">Sin resultados.</p>}
                </div>
                {!respBuscar.trim() && usuariosUnicos.length > usuariosFiltrados.length && (
                  <p className="mt-1 font-body text-[11px] text-gray-400">
                    Mostrando {usuariosFiltrados.length} de {usuariosUnicos.length}. Escribe arriba para encontrar a alguien más.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button onClick={() => setModalBorr(false)} className="font-body text-sm text-gray-500 px-3 py-2">Cancelar</button>
              <button onClick={guardarBorr} disabled={pending}
                className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
