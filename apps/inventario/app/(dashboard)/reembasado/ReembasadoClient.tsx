'use client'

import { useMemo, useState } from 'react'
import {
  Split, Plus, Trash2, Play, Loader2, Package, ArrowRight, X, Search, PackageOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { usePermisos } from '@/components/permisos/PermisosProvider'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProdLite { id: string; nombre_estandar: string; presentacion: string | null; ref: number | null }
interface Destino { id?: string; producto_destino_id: string; cantidad: number; destino?: ProdLite | null }
export interface Receta {
  id: string; nombre: string; descripcion: string | null; cantidad_origen: number
  activo: boolean; producto_origen_id: string; origen: ProdLite | null; items: Destino[]
}
interface StockRow { producto_id: string; cantidad_disp: number }

export const etiqueta = (p?: ProdLite | null) =>
  p ? `${p.nombre_estandar}${p.presentacion ? ' · ' + p.presentacion : ''}${p.ref ? ' (REF ' + p.ref + ')' : ''}` : '—'

/** Combobox de producto con búsqueda (sobre el listado ya cargado). */
function ProductoPicker({
  productos, value, onChange, placeholder, excluir = [],
}: {
  productos: ProdLite[]; value: string; onChange: (id: string) => void
  placeholder: string; excluir?: string[]
}) {
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(false)
  const sel = productos.find((p) => p.id === value) ?? null
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return productos
      .filter((p) => !excluir.includes(p.id))
      .filter((p) => !t || `${p.nombre_estandar} ${p.presentacion ?? ''} ${p.ref ?? ''}`.toLowerCase().includes(t))
      .slice(0, 30)
  }, [productos, q, excluir])

  if (sel && !abierto) {
    return (
      <button type="button" onClick={() => { setAbierto(true); setQ('') }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-green">
        <span className="truncate">{etiqueta(sel)}</span>
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
      </button>
    )
  }
  return (
    <div className="relative">
      <input
        autoFocus={abierto}
        value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        onFocus={() => setAbierto(true)}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green"
      />
      {abierto && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtrados.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados.</p>
          ) : filtrados.map((p) => (
            <button key={p.id} type="button"
              onClick={() => { onChange(p.id); setAbierto(false); setQ('') }}
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-brand-green/5">
              {etiqueta(p)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReembasadoClient({
  recetas: recetasIni, productos, stock: stockIni,
}: {
  recetas: Receta[]; productos: ProdLite[]; stock: StockRow[]
}) {
  const { puede } = usePermisos()
  const gestiona = puede('gestionar_reembasado')
  const [sb] = useState<any>(() => createClient())

  const [recetas, setRecetas] = useState<Receta[]>(recetasIni)
  const [stock, setStock] = useState<Map<string, number>>(
    () => new Map(stockIni.map((s) => [s.producto_id, Number(s.cantidad_disp)])),
  )
  const [creando, setCreando] = useState(false)
  const [ejecutar, setEjecutar] = useState<Receta | null>(null)

  const dispDe = (pid?: string | null) => (pid ? stock.get(pid) ?? 0 : 0)

  async function borrar(r: Receta) {
    if (!window.confirm(`¿Eliminar la receta "${r.nombre}"?`)) return
    const { error } = await sb.from('reembasados').delete().eq('id', r.id)
    if (error) { toast.error('No se pudo eliminar.'); return }
    setRecetas((prev) => prev.filter((x) => x.id !== r.id))
    toast.success('Receta eliminada.')
  }

  function onEjecutado(r: Receta, veces: number) {
    // Refleja el movimiento de stock en la UI (SALIDA origen + ENTRADA destinos).
    setStock((prev) => {
      const m = new Map(prev)
      m.set(r.producto_origen_id, (m.get(r.producto_origen_id) ?? 0) - r.cantidad_origen * veces)
      for (const it of r.items) m.set(it.producto_destino_id, (m.get(it.producto_destino_id) ?? 0) + it.cantidad * veces)
      return m
    })
  }

  return (
    <div className="space-y-5">
      {gestiona && (
        <button onClick={() => setCreando((v) => !v)}
          className="flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 font-body text-sm font-semibold text-white hover:bg-brand-green-dark">
          <Plus className="h-4 w-4" /> Nueva receta de reembasado
        </button>
      )}

      {creando && gestiona && (
        <CrearReceta
          sb={sb} productos={productos}
          onCancel={() => setCreando(false)}
          onCreada={(r) => { setRecetas((prev) => [r, ...prev]); setCreando(false) }}
        />
      )}

      {recetas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 py-16 text-gray-400">
          <PackageOpen className="h-8 w-8" />
          <p className="font-body text-sm">Aún no hay recetas de reembasado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recetas.map((r) => (
            <div key={r.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-heading text-sm font-bold text-gray-900">{r.nombre}</p>
                  {r.descripcion && <p className="mt-0.5 text-xs text-gray-500">{r.descripcion}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {gestiona && (
                    <button onClick={() => setEjecutar(r)}
                      className="flex items-center gap-1 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-green-dark">
                      <Play className="h-3.5 w-3.5" /> Reembasar
                    </button>
                  )}
                  {gestiona && (
                    <button onClick={() => borrar(r)} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Origen → destinos */}
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-amber-900">
                    <Package className="h-4 w-4" /> {Number(r.cantidad_origen)} × {etiqueta(r.origen)}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">Disponible: {dispDe(r.producto_origen_id)}</p>
                </div>
                <ArrowRight className="hidden h-5 w-5 shrink-0 text-gray-300 sm:block" />
                <div className="flex flex-1 flex-wrap gap-2">
                  {r.items.map((it, i) => (
                    <div key={it.id ?? i} className="rounded-lg bg-brand-green/5 px-3 py-2 text-sm">
                      <p className="font-medium text-brand-green-dark">{Number(it.cantidad)} × {etiqueta(it.destino)}</p>
                      <p className="mt-0.5 text-xs text-gray-400">Disponible: {dispDe(it.producto_destino_id)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ejecutar && (
        <EjecutarModal
          sb={sb} receta={ejecutar} dispOrigen={dispDe(ejecutar.producto_origen_id)}
          onCerrar={() => setEjecutar(null)}
          onHecho={(veces) => { onEjecutado(ejecutar, veces); setEjecutar(null) }}
        />
      )}
    </div>
  )
}

// ── Crear receta ─────────────────────────────────────────────────────────────
function CrearReceta({
  sb, productos, onCancel, onCreada,
}: {
  sb: any; productos: ProdLite[]; onCancel: () => void; onCreada: (r: Receta) => void
}) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [origen, setOrigen] = useState('')
  const [cantidadOrigen, setCantidadOrigen] = useState('1')
  const [items, setItems] = useState<{ producto_destino_id: string; cantidad: string }[]>([{ producto_destino_id: '', cantidad: '' }])
  const [guardando, setGuardando] = useState(false)

  const prodMap = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const setItem = (i: number, patch: Partial<{ producto_destino_id: string; cantidad: string }>) =>
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function guardar() {
    const co = Number(cantidadOrigen)
    const dest = items.filter((it) => it.producto_destino_id && Number(it.cantidad) > 0)
    if (!nombre.trim()) { toast.error('Ponle un nombre a la receta.'); return }
    if (!origen) { toast.error('Elige el producto origen.'); return }
    if (!(co > 0)) { toast.error('La cantidad de origen debe ser mayor que cero.'); return }
    if (dest.length === 0) { toast.error('Agrega al menos un producto destino con cantidad.'); return }
    if (dest.some((d) => d.producto_destino_id === origen)) { toast.error('Un destino no puede ser el mismo producto origen.'); return }
    setGuardando(true)
    try {
      const { data: rec, error } = await sb.from('reembasados').insert({
        nombre: nombre.trim(), descripcion: descripcion.trim() || null,
        producto_origen_id: origen, cantidad_origen: co,
      }).select('id, nombre, descripcion, cantidad_origen, activo, producto_origen_id').single()
      if (error || !rec) { toast.error(error?.message ?? 'No se pudo crear.'); return }

      const filas = dest.map((d) => ({ reembasado_id: rec.id, producto_destino_id: d.producto_destino_id, cantidad: Number(d.cantidad) }))
      const { error: e2 } = await sb.from('reembasado_items').insert(filas)
      if (e2) { await sb.from('reembasados').delete().eq('id', rec.id); toast.error('No se pudieron guardar los destinos.'); return }

      await logActivity(sb, { accion: 'CREAR', modulo: 'Reembasado', descripcion: `Receta: ${nombre}`, entidad: 'reembasados', entidad_id: rec.id })
      onCreada({
        ...(rec as any),
        origen: prodMap.get(origen) ?? null,
        items: dest.map((d) => ({ producto_destino_id: d.producto_destino_id, cantidad: Number(d.cantidad), destino: prodMap.get(d.producto_destino_id) ?? null })),
      })
      toast.success('Receta creada.')
    } finally { setGuardando(false) }
  }

  return (
    <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-heading text-sm font-bold text-gray-900"><Split className="h-4 w-4 text-brand-green" /> Nueva receta</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Nombre de la receta</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cuñete 20L → botellas 500ml"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Descripción (opcional)</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr,140px]">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Producto origen (se consume)</label>
          <ProductoPicker productos={productos} value={origen} onChange={setOrigen} placeholder="Busca el producto grande…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Cantidad que consume</label>
          <input type="number" min={0} step="any" value={cantidadOrigen} onChange={(e) => setCantidadOrigen(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Productos que genera</label>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr,120px,40px]">
              <ProductoPicker productos={productos} value={it.producto_destino_id}
                onChange={(id) => setItem(i, { producto_destino_id: id })}
                placeholder="Busca el producto pequeño…" excluir={origen ? [origen] : []} />
              <input type="number" min={0} step="any" placeholder="Cantidad" value={it.cantidad}
                onChange={(e) => setItem(i, { cantidad: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
              <button onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                className="flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50" disabled={items.length === 1}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button onClick={() => setItems((p) => [...p, { producto_destino_id: '', cantidad: '' }])}
            className="flex items-center gap-1 text-xs font-semibold text-brand-green"><Plus className="h-3.5 w-3.5" /> Agregar producto</button>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600">Cancelar</button>
        <button onClick={guardar} disabled={guardando}
          className="flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar receta
        </button>
      </div>
    </div>
  )
}

// ── Ejecutar ─────────────────────────────────────────────────────────────────
export function EjecutarModal({
  sb, receta, dispOrigen, onCerrar, onHecho,
}: {
  sb: any; receta: Receta; dispOrigen: number; onCerrar: () => void; onHecho: (veces: number) => void
}) {
  const [veces, setVeces] = useState('1')
  const [obs, setObs] = useState('')
  const [ejecutando, setEjecutando] = useState(false)
  const n = Number(veces)
  const consumo = receta.cantidad_origen * (n || 0)
  const suficiente = consumo > 0 && consumo <= dispOrigen

  async function correr() {
    if (!suficiente) { toast.error('Cantidad inválida o stock insuficiente.'); return }
    setEjecutando(true)
    try {
      const { error } = await sb.rpc('ejecutar_reembasado', { p_reembasado: receta.id, p_veces: n, p_observacion: obs.trim() || null })
      if (error) { toast.error(error.message); return }
      await logActivity(sb, { accion: 'EJECUTAR', modulo: 'Reembasado', descripcion: `${receta.nombre} ×${n}`, entidad: 'reembasados', entidad_id: receta.id })
      toast.success('Reembasado realizado. El stock se actualizó.')
      onHecho(n)
    } finally { setEjecutando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-heading text-base font-bold text-gray-900"><Play className="h-4 w-4 text-brand-green" /> Reembasar</p>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-gray-600">{receta.nombre}</p>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">¿Cuántas veces?</label>
          <input type="number" min={1} step="any" value={veces} onChange={(e) => setVeces(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </div>

        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <p className="flex justify-between"><span className="text-gray-500">Consume</span>
            <span className={'font-semibold ' + (suficiente ? 'text-gray-800' : 'text-red-600')}>
              {consumo} de {etiqueta(receta.origen)}
            </span></p>
          <p className="mt-0.5 text-xs text-gray-400">Disponible: {dispOrigen}</p>
          <div className="mt-2 border-t border-gray-100 pt-2 space-y-0.5">
            {receta.items.map((it, i) => (
              <p key={i} className="flex justify-between text-xs">
                <span className="text-gray-500">Genera</span>
                <span className="font-medium text-brand-green-dark">{Number(it.cantidad) * (n || 0)} × {etiqueta(it.destino)}</span>
              </p>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Observación (opcional)</label>
          <input value={obs} onChange={(e) => setObs(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </div>

        {!suficiente && consumo > 0 && (
          <p className="text-xs text-red-600">No hay stock suficiente del producto origen.</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600">Cancelar</button>
          <button onClick={correr} disabled={ejecutando || !suficiente}
            className="flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
            {ejecutando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
