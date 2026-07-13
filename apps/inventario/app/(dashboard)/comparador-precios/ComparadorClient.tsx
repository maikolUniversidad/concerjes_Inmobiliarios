'use client'

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import {
  Search, Scale, Store, TrendingDown, PiggyBank, Plus, X, Loader2, Pencil, Trash2,
  ShoppingCart, ChevronDown, ChevronRight, Award, RefreshCw, PackageSearch, Tag,
} from 'lucide-react'
import { toast } from 'sonner'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { guardarPrecio, eliminarPrecio, importarDesdeProductos, type ActionResult } from './actions'

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface ProveedorLite { id: string; nombre: string; es_principal: boolean }

interface PrecioRow { id: string; proveedor_id: string; precio: number | null; vigente: boolean; fecha_cotiz: string | null }

export interface ProductoPrecios {
  id: string
  ref: number | null
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  tipo_insumo: string
  precio_lista: number | null
  proveedor_id: string | null
  precio_lista2: number | null
  proveedor2_id: string | null
  precios_proveedor: PrecioRow[] | null
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green bg-white'

type Filtro = 'con-precios' | 'comparables' | 'todos'

// ── Componente principal ──────────────────────────────────────────────────────
export function ComparadorClient({ productos, proveedores }: { productos: ProductoPrecios[]; proveedores: ProveedorLite[] }) {
  const { puede } = usePermisos()
  const puedeEditar = puede('editar_proveedores')
  const puedeCrearOC = puede('crear_ordenes_compra')

  const provMap = useMemo(() => new Map(proveedores.map((p) => [p.id, p])), [proveedores])
  const provNombre = (id: string) => provMap.get(id)?.nombre ?? 'Proveedor'

  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('con-precios')
  const [expandido, setExpandido] = useState<Set<string>>(new Set())
  const [limite, setLimite] = useState(40)
  const [modal, setModal] = useState<ModalState>(null)
  const [importando, startImport] = useTransition()

  // Derivar precios ordenados + métricas por producto
  const filas = useMemo(() => {
    return productos.map((p) => {
      const precios = [...(p.precios_proveedor ?? [])]
        .map((x) => ({ ...x, nombre: provNombre(x.proveedor_id) }))
        .sort((a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity))
      const conPrecio = precios.filter((x) => x.precio != null) as (PrecioRow & { nombre: string; precio: number })[]
      const best = conPrecio[0]?.precio ?? null
      const worst = conPrecio.length ? conPrecio[conPrecio.length - 1].precio : null
      const ahorro = best != null && worst != null ? worst - best : 0
      return { p, precios, nProv: precios.length, best, worst, ahorro }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, provMap])

  // KPIs
  const kpis = useMemo(() => {
    const conPrecio = filas.filter((f) => f.nProv > 0).length
    const comparables = filas.filter((f) => f.nProv >= 2).length
    const ahorro = filas.reduce((s, f) => s + (f.nProv >= 2 ? f.ahorro : 0), 0)
    return { conPrecio, comparables, ahorro }
  }, [filas])

  // Precios en fichas de producto aún no reflejados en la matriz (para "sincronizar")
  const importables = useMemo(() => {
    let n = 0
    for (const p of productos) {
      const set = new Set((p.precios_proveedor ?? []).map((x) => x.proveedor_id))
      if (p.proveedor_id && p.precio_lista != null && !set.has(p.proveedor_id)) n++
      if (p.proveedor2_id && p.precio_lista2 != null && !set.has(p.proveedor2_id)) n++
    }
    return n
  }, [productos])

  // Filtrado + búsqueda
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return filas.filter((f) => {
      if (filtro === 'con-precios' && f.nProv === 0) return false
      if (filtro === 'comparables' && f.nProv < 2) return false
      if (!t) return true
      return (
        f.p.nombre_estandar.toLowerCase().includes(t) ||
        (f.p.presentacion ?? '').toLowerCase().includes(t) ||
        String(f.p.ref ?? '').includes(t) ||
        String(f.p.codigo ?? '').includes(t)
      )
    })
  }, [filas, filtro, q])

  const visibles = filtradas.slice(0, limite)

  function toggle(id: string) {
    setExpandido((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function sincronizar() {
    startImport(async () => {
      const r = await importarDesdeProductos()
      if (r.error) toast.error(r.error)
      else toast.success(r.mensaje ?? 'Precios sincronizados.')
    })
  }

  const sinDatos = kpis.conPrecio === 0

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Store} label="Proveedores activos" value={proveedores.length} color="text-blue-600 bg-blue-50 border-blue-100" />
        <KpiCard icon={Tag} label="Productos con precio" value={kpis.conPrecio} color="text-brand-green bg-green-50 border-green-100" />
        <KpiCard icon={Scale} label="Comparables (2+ prov.)" value={kpis.comparables} color="text-purple-600 bg-purple-50 border-purple-100" />
        <KpiCard icon={PiggyBank} label="Ahorro potencial" value={cop.format(kpis.ahorro)} color="text-amber-600 bg-amber-50 border-amber-100" small />
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, ref o código…"
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400 bg-transparent" />
        </div>
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {([['con-precios', 'Con precio'], ['comparables', 'Comparables'], ['todos', 'Todos']] as [Filtro, string][]).map(([id, lbl]) => (
            <button key={id} onClick={() => { setFiltro(id); setLimite(40) }}
              className={`rounded-md px-3 py-1.5 font-body text-xs font-semibold transition-colors ${filtro === id ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {lbl}
            </button>
          ))}
        </div>
        {puedeEditar && importables > 0 && (
          <button onClick={sincronizar} disabled={importando}
            className="flex items-center gap-1.5 border border-brand-green text-brand-green font-body font-semibold text-xs px-3 py-2 rounded-lg hover:bg-green-50 disabled:opacity-60">
            {importando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sincronizar {importables} de fichas
          </button>
        )}
      </div>

      {/* Estado vacío / CTA de sincronización */}
      {sinDatos ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
          <PackageSearch className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-heading font-bold text-gray-900">Aún no hay precios por proveedor</p>
          <p className="font-body text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Sincroniza los proveedores y precios que ya tienes en las fichas de productos, o agrega precios manualmente por producto.
          </p>
          {puedeEditar && importables > 0 && (
            <button onClick={sincronizar} disabled={importando}
              className="mt-4 inline-flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-brand-green-dark disabled:opacity-60">
              {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar {importables} precios desde fichas
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {visibles.map((f) => (
              <ProductoCard
                key={f.p.id}
                fila={f}
                abierto={expandido.has(f.p.id)}
                onToggle={() => toggle(f.p.id)}
                puedeEditar={puedeEditar}
                puedeCrearOC={puedeCrearOC}
                onAgregar={() => setModal({ productoId: f.p.id, productoNombre: f.p.nombre_estandar, usados: f.precios.map((x) => x.proveedor_id) })}
                onEditar={(pr) => setModal({ productoId: f.p.id, productoNombre: f.p.nombre_estandar, usados: [], editing: pr })}
              />
            ))}
          </div>

          {filtradas.length === 0 && (
            <p className="text-center py-10 font-body text-sm text-gray-400">Ningún producto coincide con el filtro.</p>
          )}
          {visibles.length < filtradas.length && (
            <div className="text-center">
              <button onClick={() => setLimite((l) => l + 40)}
                className="font-body text-sm text-brand-green hover:underline">
                Ver más ({filtradas.length - visibles.length} restantes)
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal precio */}
      {modal && (
        <PrecioModal
          modal={modal}
          proveedores={proveedores}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── KPI ───────────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color, small }: { icon: typeof Store; label: string; value: string | number; color: string; small?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${color} flex items-start gap-3`}>
      <Icon className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className={`font-heading font-bold text-gray-900 ${small ? 'text-lg' : 'text-2xl'} truncate`}>{value}</p>
        <p className="font-body text-xs">{label}</p>
      </div>
    </div>
  )
}

// ── Tarjeta de producto ─────────────────────────────────────────────────────────
type Fila = { p: ProductoPrecios; precios: (PrecioRow & { nombre: string })[]; nProv: number; best: number | null; worst: number | null; ahorro: number }

function ProductoCard({ fila, abierto, onToggle, puedeEditar, puedeCrearOC, onAgregar, onEditar }: {
  fila: Fila
  abierto: boolean
  onToggle: () => void
  puedeEditar: boolean
  puedeCrearOC: boolean
  onAgregar: () => void
  onEditar: (pr: PrecioRow) => void
}) {
  const { p, precios, nProv, best, ahorro } = fila
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* Cabecera */}
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/70 transition-colors">
        {abierto ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-body font-semibold text-sm text-gray-900 truncate">{p.nombre_estandar}</p>
          <p className="font-body text-xs text-gray-400 truncate">
            {p.presentacion ? `${p.presentacion} · ` : ''}{p.ref ? `Ref ${p.ref}` : p.codigo ? `Cód ${p.codigo}` : p.tipo_insumo}
          </p>
        </div>
        {/* Resumen */}
        <div className="flex items-center gap-2 shrink-0">
          {nProv >= 2 && ahorro > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-medium" title="Diferencia entre el proveedor más caro y el más barato">
              <TrendingDown className="w-3 h-3" /> {cop.format(ahorro)}
            </span>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${nProv === 0 ? 'bg-gray-100 text-gray-500' : nProv >= 2 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
            <Store className="w-3 h-3" /> {nProv} prov.
          </span>
          {best != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[11px] font-semibold">
              <Award className="w-3 h-3" /> {cop.format(best)}
            </span>
          )}
        </div>
      </button>

      {/* Detalle: precios por proveedor */}
      {abierto && (
        <div className="border-t border-gray-100 px-3 py-3 space-y-2 bg-gray-50/40">
          {precios.length === 0 && (
            <p className="px-1 py-2 font-body text-sm text-gray-400">Este producto aún no tiene precios de proveedor.</p>
          )}
          {precios.map((pr, i) => {
            const esMejor = pr.precio != null && pr.precio === best
            const sobrecosto = pr.precio != null && best != null && best > 0 ? Math.round(((pr.precio - best) / best) * 100) : 0
            return (
              <div key={pr.id} className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 ${esMejor ? 'border-green-200' : 'border-gray-100'}`}>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold shrink-0 ${esMejor ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {esMejor ? <Award className="w-4 h-4" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-medium text-gray-800 truncate">{pr.nombre}</p>
                  <p className="font-body text-[11px] text-gray-400">
                    {pr.fecha_cotiz ? `Cotiz. ${new Date(pr.fecha_cotiz).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Sin fecha'}
                    {!pr.vigente && ' · no vigente'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-heading font-bold text-sm ${esMejor ? 'text-green-700' : 'text-gray-900'}`}>
                    {pr.precio != null ? cop.format(pr.precio) : '—'}
                  </p>
                  {esMejor ? (
                    <p className="font-body text-[10px] text-green-600 font-semibold">Mejor precio</p>
                  ) : sobrecosto > 0 ? (
                    <p className="font-body text-[10px] text-red-500">+{sobrecosto}% vs. mejor</p>
                  ) : null}
                </div>
                {/* Acciones */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {puedeCrearOC && pr.precio != null && (
                    <Link
                      href={`/ordenes-compra/nuevo?proveedor=${pr.proveedor_id}&producto=${p.id}&precio=${pr.precio}`}
                      title="Crear orden de compra con este proveedor"
                      className="p-2 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50">
                      <ShoppingCart className="w-4 h-4" />
                    </Link>
                  )}
                  {puedeEditar && (
                    <>
                      <button onClick={() => onEditar(pr)} title="Editar precio" className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <DeleteButton action={eliminarPrecio} id={pr.id} mensaje={`¿Quitar el precio de ${pr.nombre}?`}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </DeleteButton>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {puedeEditar && (
            <button onClick={onAgregar}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 py-2.5 font-body text-sm text-gray-500 hover:border-brand-green hover:text-brand-green hover:bg-green-50/40 transition-colors">
              <Plus className="w-4 h-4" /> Agregar proveedor / precio
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Modal de precio ─────────────────────────────────────────────────────────────
type ModalState = {
  productoId: string
  productoNombre: string
  usados: string[]
  editing?: PrecioRow
} | null

function ModalSubmit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      {editing ? 'Guardar cambios' : 'Agregar precio'}
    </button>
  )
}

function PrecioModal({ modal, proveedores, onClose }: { modal: NonNullable<ModalState>; proveedores: ProveedorLite[]; onClose: () => void }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(guardarPrecio, {})
  useEffect(() => { if (state.ok) onClose() }, [state.ok, onClose])

  const editing = modal.editing
  const disponibles = editing
    ? proveedores
    : proveedores.filter((p) => !modal.usados.includes(p.id))

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-2xl bg-white shadow-2xl sm:inset-0 sm:m-auto sm:h-fit sm:rounded-2xl">
        <form action={formAction} className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-gray-900">{editing ? 'Editar precio' : 'Agregar proveedor'}</h2>
              <p className="font-body text-xs text-gray-400 truncate">{modal.productoNombre}</p>
            </div>
            <button type="button" onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
          </div>

          <input type="hidden" name="producto_id" value={modal.productoId} />
          {state.error && <p className="font-body text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{state.error}</p>}

          <div>
            <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Proveedor *</label>
            {editing ? (
              <>
                <input type="hidden" name="proveedor_id" value={editing.proveedor_id} />
                <div className={inputCls + ' text-gray-700'}>{proveedores.find((p) => p.id === editing.proveedor_id)?.nombre ?? 'Proveedor'}</div>
              </>
            ) : (
              <select name="proveedor_id" required defaultValue="" className={inputCls}>
                <option value="" disabled>— Selecciona —</option>
                {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.es_principal ? ' ★' : ''}</option>)}
              </select>
            )}
            {!editing && disponibles.length === 0 && (
              <p className="mt-1 font-body text-xs text-amber-600">Todos los proveedores activos ya tienen precio para este producto.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Precio (COP) *</label>
              <input name="precio" type="number" min="0" step="0.01" required defaultValue={editing?.precio ?? ''} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Fecha cotización</label>
              <input name="fecha_cotiz" type="date" defaultValue={editing?.fecha_cotiz ?? ''} className={inputCls} />
            </div>
          </div>

          <label className="flex items-center gap-2 font-body text-sm text-gray-700">
            <input name="vigente" type="checkbox" defaultChecked={editing ? editing.vigente : true} className="w-4 h-4 accent-brand-green" /> Precio vigente
          </label>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="font-body text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancelar</button>
            <ModalSubmit editing={!!editing} />
          </div>
        </form>
      </div>
    </>
  )
}
