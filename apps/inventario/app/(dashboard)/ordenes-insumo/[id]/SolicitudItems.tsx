'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Plus, Trash2, Search, Loader2, User2, AlertTriangle, PackageSearch } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginado'
import { actualizarItemSolicitado, agregarItemSolicitado, quitarItemSolicitado } from '../actions'
import { ProductoThumb } from './ProductoThumb'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

interface Item {
  id: string
  producto_id: string
  cantidad_solicitada: number
  es_adicional?: boolean
  modificado_nombre?: string | null
  modificado_at?: string | null
  producto: { nombre_estandar: string; presentacion: string | null; imagen_url?: string | null } | null
}
interface ProdOpt { id: string; nombre: string; presentacion: string | null }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

function fmtCorto(iso?: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Productos de la solicitud. Siempre visible. En estados post-aprobación los
 * cambios quedan como novedad en la trazabilidad y generan notificación.
 */
/** Cambio que espera el visto bueno del usuario (pedido ya en alistamiento). */
interface CambioPendiente {
  titulo: string
  detalle: string
  ejecutar: () => void
  cancelar?: () => void
}

export function SolicitudItems({ ordenId, items: itemsIniciales, puedeEditar, esAprobada = false, enAlistamiento = false }: {
  ordenId: string
  items: Item[]
  puedeEditar: boolean
  esAprobada?: boolean
  /** La bodega ya está alistando: todo cambio pide confirmación. */
  enAlistamiento?: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [items, setItems] = useState<Item[]>(itemsIniciales ?? [])
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    () => Object.fromEntries((itemsIniciales ?? []).map((i) => [i.id, Number(i.cantidad_solicitada)])),
  )
  const [catalogo, setCatalogo] = useState<ProdOpt[]>([])
  const [buscar, setBuscar] = useState('')
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [cambio, setCambio] = useState<CambioPendiente | null>(null)

  /** En alistamiento, pasa el cambio por el pop-up; si no, lo aplica directo. */
  function conConfirmacion(c: CambioPendiente) {
    if (enAlistamiento) setCambio(c)
    else c.ejecutar()
  }
  // Stock proyectado (real − comprometido en otras órdenes en cola).
  const [stock, setStock] = useState<Map<string, { real: number; disponible: number }>>(new Map())

  useEffect(() => {
    let vivo = true
    // Paginado: PostgREST corta en 1.000 filas (`.limit()` no levanta el tope).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    traerTodo<any>((desde, hasta) =>
      sb.from('v_stock_proyectado').select('producto_id, stock_real, disponible')
        .order('producto_id').range(desde, hasta),
    ).then((filas) => {
      if (!vivo) return
      const m = new Map<string, { real: number; disponible: number }>()
      for (const r of filas) m.set(r.producto_id, { real: Number(r.stock_real), disponible: Number(r.disponible) })
      setStock(m)
    })
    return () => { vivo = false }
  }, [sb])

  useEffect(() => {
    setItems(itemsIniciales ?? [])
    setCantidades(Object.fromEntries((itemsIniciales ?? []).map((i) => [i.id, Number(i.cantidad_solicitada)])))
  }, [itemsIniciales])

  // Catálogo para agregar productos (solo si se puede editar).
  useEffect(() => {
    if (!puedeEditar) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    traerTodo<any>((desde, hasta) =>
      sb.from('productos').select('id, nombre_estandar, presentacion').eq('activo', true)
        .order('nombre_estandar').order('id').range(desde, hasta),
    ).then((filas) => {
      setCatalogo(filas.map((p) => ({ id: p.id, nombre: p.nombre_estandar, presentacion: p.presentacion ?? null })))
    })
  }, [sb, puedeEditar])

  const yaEnOrden = useMemo(() => new Set(items.map((i) => i.producto_id)), [items])

  const sugerencias = useMemo(() => {
    const q = norm(buscar.trim())
    const libres = catalogo.filter((p) => !yaEnOrden.has(p.id))
    if (!q) return libres.slice(0, 8)
    const tokens = q.split(/\s+/)
    return libres.filter((p) => {
      const hay = norm(`${p.nombre} ${p.presentacion ?? ''}`)
      return tokens.every((t) => hay.includes(t))
    }).slice(0, 8)
  }, [buscar, catalogo, yaEnOrden])

  function guardarCantidad(it: Item) {
    const nueva = Math.max(0, Number(cantidades[it.id]) || 0)
    const antes = Number(it.cantidad_solicitada)
    if (nueva === antes) return
    const nombre = it.producto?.nombre_estandar ?? 'producto'
    conConfirmacion({
      titulo: 'Cambiar la cantidad',
      detalle: `«${nombre}»: ${antes} → ${nueva}.`,
      ejecutar: () => start(async () => {
        const r = await actualizarItemSolicitado(ordenId, it.id, nueva, enAlistamiento)
        if (r.error) { toast.error(r.error); return }
        toast.success('Cantidad actualizada')
        router.refresh()
      }),
      // Si se arrepiente, el campo vuelve a la cantidad que tenía.
      cancelar: () => setCantidades((prev) => ({ ...prev, [it.id]: antes })),
    })
  }

  function agregar(p: ProdOpt) {
    conConfirmacion({
      titulo: 'Agregar un producto',
      detalle: `Se agrega «${p.nombre}» (1 unidad) a la orden.`,
      ejecutar: () => {
        setBusy(p.id)
        start(async () => {
          const r = await agregarItemSolicitado(ordenId, p.id, 1, true, enAlistamiento)
          setBusy(null)
          if (r.error) { toast.error(r.error); return }
          toast.success(`«${p.nombre}» agregado`)
          setBuscar('')
          router.refresh()
        })
      },
    })
  }

  function quitar(it: Item) {
    const nombre = it.producto?.nombre_estandar ?? 'producto'
    // Fuera de alistamiento basta la confirmación de siempre.
    if (!enAlistamiento && !window.confirm(`¿Quitar «${nombre}» de la orden?`)) return
    conConfirmacion({
      titulo: 'Quitar un producto',
      detalle: `Se quita «${nombre}» de la orden.`,
      ejecutar: () => {
        setBusy(it.id)
        start(async () => {
          const r = await quitarItemSolicitado(ordenId, it.id, enAlistamiento)
          setBusy(null)
          if (r.error) { toast.error(r.error); return }
          toast.success('Producto quitado')
          router.refresh()
        })
      },
    })
  }

  const columnas: ColumnaTabla<Item>[] = [
    {
      id: 'producto', header: 'Producto', valor: (it) => it.producto?.nombre_estandar ?? '',
      ancho: 'min-w-[240px]', tarjeta: 'titulo',
      celda: (it) => (
        <div className="flex items-start gap-2.5">
          <ProductoThumb url={it.producto?.imagen_url} nombre={it.producto?.nombre_estandar} />
          <div className="min-w-0">
            <p className="font-body text-sm text-gray-900 break-words leading-snug">{it.producto?.nombre_estandar ?? '—'}</p>
            {it.producto?.presentacion && <p className="font-body text-[11px] text-gray-400 mt-0.5">{it.producto.presentacion}</p>}
          </div>
        </div>
      ),
    },
    { id: 'presentacion', header: 'Presentación', valor: (it) => it.producto?.presentacion ?? '', prioridad: 3, className: 'text-xs text-gray-400', tarjeta: 'subtitulo' },
    {
      id: 'tipo', header: 'Tipo', valor: (it) => (it.es_adicional ? 'Adicional' : 'Parametrizado'),
      ancho: 'w-28', prioridad: 2, tarjeta: 'badge',
      celda: (it) => it.es_adicional
        ? <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Adicional</span>
        : <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">Parametrizado</span>,
    },
    {
      id: 'inventario', header: 'Inventario', align: 'center', ancho: 'w-28', prioridad: 2, tarjeta: 'meta',
      valor: (it) => stock.get(it.producto_id)?.disponible ?? '',
      copiaTexto: (it) => {
        const st = stock.get(it.producto_id)
        return st ? `Stock ${st.real} / Disp ${st.disponible}` : ''
      },
      celda: (it) => {
        const st = stock.get(it.producto_id)
        if (!st) return <span className="font-body text-xs text-gray-300">—</span>
        const neg = st.disponible < 0
        return (
          <div className="leading-tight">
            <p className="font-body text-xs text-gray-500">Stock: <span className="font-semibold text-gray-700">{st.real}</span></p>
            <p className={`font-body text-xs font-semibold ${neg ? 'text-red-600' : 'text-emerald-600'}`}>Disp: {st.disponible}</p>
          </div>
        )
      },
    },
    {
      id: 'cantidad', header: 'Cantidad', align: 'center', ancho: 'w-28', interactiva: puedeEditar, tarjeta: 'meta',
      valor: (it) => Number(it.cantidad_solicitada),
      celda: (it) => puedeEditar ? (
        <input type="number" min={0} step="1"
          value={cantidades[it.id] ?? 0}
          onChange={(e) => setCantidades((prev) => ({ ...prev, [it.id]: Number(e.target.value) || 0 }))}
          onBlur={() => guardarCantidad(it)}
          disabled={pending}
          className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 font-body text-sm text-center outline-none focus:border-brand-green disabled:bg-gray-50" />
      ) : (
        <span className="font-body text-sm font-semibold text-gray-700">{Number(it.cantidad_solicitada)}</span>
      ),
    },
    {
      id: 'modificado', header: 'Modificado por', ancho: 'w-44', prioridad: 3, tarjeta: 'meta',
      valor: (it) => it.modificado_nombre ?? '',
      celda: (it) => it.modificado_nombre ? (
        <span className="inline-flex items-center gap-1.5 font-body text-xs text-gray-600">
          <User2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate max-w-[130px]">{it.modificado_nombre}</span>
            {it.modificado_at && <span className="block text-[10px] text-gray-400">{fmtCorto(it.modificado_at)}</span>}
          </span>
        </span>
      ) : (
        <span className="font-body text-xs text-gray-300">—</span>
      ),
    },
  ]

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-green" /> Productos de la solicitud
        </p>
        <span className="font-body text-xs text-gray-400">{items.length} ítem(s)</span>
      </div>
      {enAlistamiento && puedeEditar ? (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-orange-50 border-b border-orange-100">
          <PackageSearch className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <p className="font-body text-xs text-orange-900">
            <span className="font-semibold">La bodega ya está alistando este pedido.</span> Cada cambio te pedirá confirmación:
            el producto vuelve a pendiente para que lo revisen de nuevo y se avisa a los coordinadores.
          </p>
        </div>
      ) : esAprobada && puedeEditar && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="font-body text-xs text-amber-800">
            <span className="font-semibold">Orden aprobada.</span> Cualquier cambio queda registrado como novedad en la trazabilidad y genera una notificación.
          </p>
        </div>
      )}

      <div className="p-4">
        <TablaEstandar
          id="orden-solicitud-items"
          titulo="Productos de la solicitud"
          modulo="Inventario"
          entidad="orden_insumo_items"
          datos={items}
          columnas={columnas}
          filaId={(it) => it.id}
          busqueda="Buscar producto de la solicitud…"
          filasPorPagina={0}
          anchoAcciones="w-12"
          filaClassName={(it) => (it.es_adicional ? 'bg-amber-50/30' : '')}
          acciones={puedeEditar ? (it) => (
            <button onClick={() => quitar(it)} disabled={busy === it.id || pending}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
              {busy === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          ) : undefined}
          vacio={<p className="font-body text-sm text-gray-400">La orden no tiene productos.</p>}
        />
      </div>

      {/* Agregar producto */}
      {puedeEditar && (
        <div className="border-t border-gray-100 p-4 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar producto para agregar…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
          </div>
          {buscar.trim() && sugerencias.length === 0 && (
            <p className="font-body text-xs text-gray-400 px-1">No existe ningún producto en el inventario para «{buscar.trim()}».</p>
          )}
          {sugerencias.length > 0 && (
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 overflow-hidden">
              {sugerencias.map((p) => (
                <button key={p.id} onClick={() => agregar(p)} disabled={busy === p.id || pending}
                  className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 hover:bg-green-50 disabled:opacity-50">
                  <span className="min-w-0">
                    <span className="font-body text-sm text-gray-800">{p.nombre}</span>
                    {p.presentacion && <span className="font-body text-xs text-gray-400"> · {p.presentacion}</span>}
                  </span>
                  {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-green shrink-0" /> : <Plus className="w-4 h-4 text-brand-green shrink-0" />}
                </button>
              ))}
            </div>
          )}
          <p className="font-body text-[11px] text-gray-400">
            Los productos que agregues aquí quedan marcados como <span className="font-semibold text-amber-700">Adicional</span> (fuera de la parametrización, sin tope).
          </p>
        </div>
      )}

      {cambio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"
          onClick={() => { cambio.cancelar?.(); setCambio(null) }}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </span>
              <div className="min-w-0">
                <p className="font-heading font-semibold text-base text-gray-900">{cambio.titulo}: ¿seguro?</p>
                <p className="font-body text-sm text-gray-700 mt-1">{cambio.detalle}</p>
              </div>
            </div>
            <div className="rounded-lg bg-orange-50 border border-orange-100 px-3 py-2.5 font-body text-xs text-orange-900 space-y-1">
              <p className="font-semibold">Este pedido ya está en alistamiento. El cambio modifica el proceso:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>La bodega tiene que volver a revisar y chulear el producto.</li>
                <li>Se notifica a los coordinadores y queda registrado en la trazabilidad.</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { cambio.cancelar?.(); setCambio(null) }}
                className="px-4 py-2 rounded-xl border border-gray-200 font-body text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => { const c = cambio; setCambio(null); c.ejecutar() }} autoFocus
                className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 font-body text-sm font-semibold text-white">
                Sí, hacer el cambio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
