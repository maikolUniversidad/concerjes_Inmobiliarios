'use client'

// Los materiales de una orden de trabajo. Lo importante de esta pantalla no se
// ve: cada fila movió inventario DE VERDAD. La RPC `mant_material_registrar`
// llama a `registrar_movimiento(SALIDA)`, el mismo camino que el resto de las
// salidas de bodega, y valida existencias contra `stock.cantidad_real` (el
// físico). Quitar un material no borra el movimiento: registra una DEVOLUCION,
// porque el inventario es un libro y no se tacha.

import { useEffect, useState, useTransition } from 'react'
import { Package, Plus, Trash2, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Hoja, inputMant, labelMant } from '@/components/mantenimiento/Hoja'

export interface MaterialOT {
  id: string; producto_id: string; producto_nombre: string | null
  cantidad: number; costo_unitario: number | null; costo_total: number
  movimiento_id: string | null; usuario_nombre: string | null; created_at: string
}

interface ProductoOpcion {
  id: string; nombre: string; presentacion: string | null
  precio_lista: number | null; cantidad_real: number
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const num = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)

export function MaterialesOT({ ticketId, materiales, cerrado, puedeEditar, onCambio }: {
  ticketId: string
  materiales: MaterialOT[]
  cerrado: boolean
  puedeEditar: boolean
  onCambio: () => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [pending, startTransition] = useTransition()
  const [quitando, setQuitando] = useState<string | null>(null)

  const total = materiales.reduce((a, m) => a + Number(m.costo_total ?? 0), 0)

  function quitar(m: MaterialOT) {
    if (!confirm(`¿Devolver ${num(Number(m.cantidad))} × ${m.producto_nombre ?? 'el material'} al inventario?`)) return
    setQuitando(m.id)
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (createClient() as any)
        .rpc('mant_material_quitar', { p_material: m.id, p_motivo: 'No se usó en la orden' })
      setQuitando(null)
      if (error) { toast.error(error.message); return }
      toast.success('Material devuelto al inventario.')
      onCambio()
    })
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className={`${labelMant} flex items-center gap-1`}>
          <Package className="w-3.5 h-3.5" /> Materiales consumidos
        </p>
        {puedeEditar && !cerrado && (
          <button onClick={() => setAbierta(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-brand-green hover:text-brand-green">
            <Plus className="w-3.5 h-3.5" /> Agregar
          </button>
        )}
      </div>

      {materiales.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          Todavía no se cargó ningún material.
          {puedeEditar && !cerrado && ' Lo que se cargue aquí sale del inventario de bodega.'}
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-gray-100">
            {materiales.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">{m.producto_nombre ?? 'Producto'}</p>
                  <p className="text-[11px] text-gray-400">
                    {num(Number(m.cantidad))}
                    {m.costo_unitario != null && ` × ${cop.format(Number(m.costo_unitario))}`}
                    {m.usuario_nombre && ` · ${m.usuario_nombre}`}
                    {/* Sin movimiento no hubo salida de bodega: es una fila que
                        no debería existir, y se dice en vez de esconderlo. */}
                    {!m.movimiento_id && ' · ⚠ sin movimiento de inventario'}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-gray-700">{cop.format(Number(m.costo_total ?? 0))}</span>
                {puedeEditar && !cerrado && (
                  <button onClick={() => quitar(m)} disabled={pending}
                    title="Devolver al inventario"
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                    {quitando === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right text-sm font-semibold text-gray-900">
            Total materiales: {cop.format(total)}
          </p>
        </>
      )}

      {abierta && (
        <AgregarMaterial ticketId={ticketId} onClose={() => setAbierta(false)}
          onListo={() => { setAbierta(false); onCambio() }} />
      )}
    </div>
  )
}

function AgregarMaterial({ ticketId, onClose, onListo }: {
  ticketId: string; onClose: () => void; onListo: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [opciones, setOpciones] = useState<ProductoOpcion[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState<ProductoOpcion | null>(null)
  const [cantidad, setCantidad] = useState('1')
  const [costo, setCosto] = useState('')
  const [pending, startTransition] = useTransition()

  // Se busca en el servidor y no se traen los 702 productos: el buscador tiene
  // que servir igual cuando el catálogo crezca.
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) { setOpciones([]); return }
    let vivo = true
    const t = setTimeout(async () => {
      setBuscando(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any
      const { data } = await sb.from('productos')
        .select('id, nombre_estandar, presentacion, precio_lista, stock(cantidad_real)')
        .eq('activo', true)
        .ilike('nombre_estandar', `%${q}%`)
        .order('nombre_estandar')
        .limit(15)
      if (!vivo) return
      setOpciones(((data ?? []) as Record<string, unknown>[]).map((p) => ({
        id: String(p.id),
        nombre: String(p.nombre_estandar),
        presentacion: (p.presentacion as string | null) ?? null,
        precio_lista: p.precio_lista != null ? Number(p.precio_lista) : null,
        cantidad_real: Number(
          (Array.isArray(p.stock) ? (p.stock[0] as { cantidad_real?: unknown })?.cantidad_real
            : (p.stock as { cantidad_real?: unknown } | null)?.cantidad_real) ?? 0,
        ),
      })))
      setBuscando(false)
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [busqueda])

  function elegir(p: ProductoOpcion) {
    setElegido(p)
    setCosto(p.precio_lista != null ? String(p.precio_lista) : '')
  }

  function guardar() {
    if (!elegido) { toast.error('Elige el material.'); return }
    const n = Number(cantidad)
    if (!Number.isFinite(n) || n <= 0) { toast.error('La cantidad debe ser mayor que cero.'); return }
    if (n > elegido.cantidad_real) {
      toast.error(`Solo hay ${num(elegido.cantidad_real)} en bodega.`); return
    }
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (createClient() as any).rpc('mant_material_registrar', {
        p_ticket: ticketId, p_producto: elegido.id, p_cantidad: n,
        p_costo_unitario: costo ? Number(costo) : null,
      })
      if (error) { toast.error(error.message); return }
      toast.success('Material cargado y descontado del inventario.')
      onListo()
    })
  }

  return (
    <Hoja abierta titulo="Agregar material a la orden" onClose={onClose}
      pie={
        <button onClick={guardar} disabled={pending || !elegido}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
          {pending && <Loader2 className="w-4 h-4 animate-spin" />} Cargar y descontar del inventario
        </button>
      }>
      <div>
        <label className={labelMant}>Buscar en el inventario</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setElegido(null) }}
            className={`${inputMant} pl-9`} placeholder="Nombre del material (mínimo 2 letras)" autoFocus />
        </div>
      </div>

      {buscando && <p className="text-xs text-gray-400">Buscando…</p>}

      {!elegido && opciones.length > 0 && (
        <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100">
          {opciones.map((p) => (
            <li key={p.id}>
              <button onClick={() => elegir(p)} disabled={p.cantidad_real <= 0}
                className="w-full px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50">
                <p className="text-sm text-gray-900">{p.nombre}{p.presentacion ? ` · ${p.presentacion}` : ''}</p>
                <p className="text-[11px] text-gray-500">
                  En bodega: {num(p.cantidad_real)}
                  {p.cantidad_real <= 0 && ' · sin existencias'}
                  {p.precio_lista != null && ` · lista ${cop.format(p.precio_lista)}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!elegido && busqueda.trim().length >= 2 && !buscando && opciones.length === 0 && (
        <p className="text-sm text-gray-500">Ningún material coincide.</p>
      )}

      {elegido && (
        <>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-900">{elegido.nombre}{elegido.presentacion ? ` · ${elegido.presentacion}` : ''}</p>
            <p className="text-[11px] text-gray-500">En bodega: {num(elegido.cantidad_real)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelMant}>Cantidad <span className="text-red-500">*</span></label>
              <input type="number" min={0} step="0.01" value={cantidad}
                onChange={(e) => setCantidad(e.target.value)} className={inputMant} />
            </div>
            <div>
              <label className={labelMant}>Costo unitario (COP)</label>
              <input type="number" min={0} value={costo} onChange={(e) => setCosto(e.target.value)}
                className={inputMant} placeholder="0" />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Al guardar sale de bodega con un movimiento de salida a nombre de esta orden. Si después no
            se usa, se devuelve desde aquí y entra un movimiento de devolución.
          </p>
        </>
      )}
    </Hoja>
  )
}
