'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2, Loader2, Check, X, PackageX, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { registrarDevolucion, type MotivoDevolucion } from '../actions'
import { ProductoThumb } from './ProductoThumb'

export interface ItemDevolucion {
  id: string
  cantidad_alistada: number
  cantidad_devuelta: number
  producto: { nombre_estandar: string; presentacion: string | null; imagen_url?: string | null; codigo?: string | null } | null
}

export interface DevolucionRegistrada {
  id: string
  motivo: string
  observacion: string | null
  reingresa_stock: boolean
  total_unidades: number
  registrado_nombre: string | null
  created_at: string
  items: { id: string; cantidad: number; producto: { nombre_estandar: string; presentacion: string | null } | null }[]
}

const MOTIVOS: { key: MotivoDevolucion; label: string; ayuda: string }[] = [
  { key: 'SOBRANTE',     label: 'Sobrante',        ayuda: 'A la sede le sobró producto en buen estado.' },
  { key: 'AVERIADO',     label: 'Averiado',        ayuda: 'Llegó roto, derramado o vencido.' },
  { key: 'ERRADO',       label: 'Producto errado', ayuda: 'No es la referencia que pidió la sede.' },
  { key: 'NO_REQUERIDO', label: 'Ya no se necesita', ayuda: 'La sede no lo necesita.' },
  { key: 'OTRO',         label: 'Otro',            ayuda: 'Explícalo en la observación.' },
]

const ETIQUETA_MOTIVO: Record<string, string> = {
  SOBRANTE: 'Sobrante', AVERIADO: 'Averiado', ERRADO: 'Producto errado',
  NO_REQUERIDO: 'Ya no se necesita', OTRO: 'Otro',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Devoluciones de una orden ya despachada: se eligen los productos del pedido y
 * cuántas unidades regresaron. Si vuelven utilizables, reingresan al stock de la
 * bodega; si vienen averiadas, queda el registro sin sumar inventario.
 */
export function DevolucionOrden({ ordenId, items, devoluciones, puedeDevolver }: {
  ordenId: string
  items: ItemDevolucion[]
  devoluciones: DevolucionRegistrada[]
  puedeDevolver: boolean
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [motivo, setMotivo] = useState<MotivoDevolucion>('SOBRANTE')
  const [observacion, setObservacion] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  // null = sigue lo que sugiere el motivo; true/false = lo forzó el usuario.
  const [reingresaManual, setReingresaManual] = useState<boolean | null>(null)

  // Solo tiene sentido devolver lo que realmente salió y aún no se ha devuelto.
  const devolvibles = useMemo(
    () => items
      .map((it) => ({ it, saldo: Number(it.cantidad_alistada ?? 0) - Number(it.cantidad_devuelta ?? 0) }))
      .filter((x) => x.saldo > 0),
    [items],
  )

  const yaDevuelto = items.reduce((s, it) => s + Number(it.cantidad_devuelta ?? 0), 0)
  const totalSeleccionado = Object.values(cantidades).reduce((s, n) => s + (Number(n) || 0), 0)
  // Lo averiado no vuelve utilizable; el resto reingresa salvo que digan lo contrario.
  const reingresa = reingresaManual ?? motivo !== 'AVERIADO'

  function setCantidad(itemId: string, valor: number, tope: number) {
    const v = Math.max(0, Math.min(tope, valor))
    setCantidades((prev) => ({ ...prev, [itemId]: v }))
  }

  function cerrar() {
    setAbierto(false); setCantidades({}); setObservacion(''); setMotivo('SOBRANTE'); setReingresaManual(null)
  }

  async function guardar() {
    const seleccion = Object.entries(cantidades)
      .map(([itemId, cantidad]) => ({ itemId, cantidad: Number(cantidad) }))
      .filter((i) => i.cantidad > 0)
    if (seleccion.length === 0) { toast.error('Escribe la cantidad devuelta de al menos un producto.'); return }

    setGuardando(true)
    const res = await registrarDevolucion(ordenId, {
      motivo, observacion, reingresaStock: reingresa, items: seleccion,
    })
    setGuardando(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(reingresa ? 'Devolución registrada y reingresada a bodega.' : 'Devolución registrada (sin reingreso a stock).')
    cerrar()
    router.refresh()
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Undo2 className="w-4 h-4 text-brand-green" /> Devoluciones
          </p>
          <p className="font-body text-xs text-gray-500 mt-0.5">
            Lo que la sede regresó de este pedido. El producto en buen estado vuelve al stock de la bodega.
          </p>
        </div>
        {puedeDevolver && !abierto && devolvibles.length > 0 && (
          <button onClick={() => setAbierto(true)}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 font-body text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-brand-green/5 hover:text-brand-green hover:border-brand-green/40 transition-colors">
            <Undo2 className="w-3.5 h-3.5" /> Registrar devolución
          </button>
        )}
      </div>

      {/* Formulario */}
      {abierto && (
        <div className="mt-4 space-y-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div>
            <p className="font-body text-sm font-semibold text-gray-800 mb-2">¿Qué productos devolvieron?</p>
            <div className="space-y-2">
              {devolvibles.map(({ it, saldo }) => {
                const cant = Number(cantidades[it.id] ?? 0)
                return (
                  <div key={it.id} className={`flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2 ${cant > 0 ? 'border-brand-green/40 ring-1 ring-brand-green/20' : 'border-gray-200'}`}>
                    <ProductoThumb url={it.producto?.imagen_url} nombre={it.producto?.nombre_estandar} />
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm text-gray-900">{it.producto?.nombre_estandar ?? '—'}</p>
                      <p className="font-body text-[11px] text-gray-400">
                        {it.producto?.presentacion ? it.producto.presentacion + ' · ' : ''}Despachado: {Number(it.cantidad_alistada)}
                        {Number(it.cantidad_devuelta) > 0 && ` · ya devuelto: ${Number(it.cantidad_devuelta)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input type="number" min={0} max={saldo} step="1" value={cantidades[it.id] ?? ''}
                        onChange={(e) => setCantidad(it.id, Number(e.target.value) || 0, saldo)}
                        placeholder="0"
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 font-body text-sm text-center outline-none focus:border-brand-green" />
                      <button type="button" onClick={() => setCantidad(it.id, saldo, saldo)}
                        title="Devolver todo lo que salió"
                        className="font-body text-[11px] font-semibold text-gray-400 hover:text-brand-green">
                        /{saldo}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <p className="font-body text-sm font-semibold text-gray-800 mb-2">Motivo</p>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS.map((m) => (
                <button key={m.key} type="button" title={m.ayuda}
                  onClick={() => { setMotivo(m.key); setReingresaManual(null) }}
                  className={`rounded-full px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                    motivo === m.key ? 'bg-brand-green text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="font-body text-xs text-gray-400 mt-1.5">{MOTIVOS.find((m) => m.key === motivo)?.ayuda}</p>
          </div>

          <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2}
            placeholder="Observación (opcional): quién la trajo, estado del producto…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green bg-white" />

          {/* Qué pasa con el stock (lo sugiere el motivo, pero se puede cambiar) */}
          <label className={`flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer ${reingresa ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
            <input type="checkbox" checked={reingresa} onChange={(e) => setReingresaManual(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-green shrink-0" />
            <span className="font-body text-xs">
              {reingresa ? <Check className="w-3.5 h-3.5 inline mr-1" /> : <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}
              {reingresa
                ? 'El producto vuelve utilizable: se suma de nuevo al stock de la bodega.'
                : 'El producto no vuelve utilizable: queda el registro de la devolución, pero NO se suma al stock.'}
            </span>
          </label>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={guardar} disabled={guardando || totalSeleccionado <= 0}
              className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
              {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              Registrar devolución{totalSeleccionado > 0 ? ` (${totalSeleccionado})` : ''}
            </button>
            <button onClick={cerrar} disabled={guardando}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 font-body text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50">
              <X className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Historial */}
      {devoluciones.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="font-body text-xs text-gray-500">
            {devoluciones.length} devolución(es) · {yaDevuelto} unidad(es) devueltas en total
          </p>
          {devoluciones.map((d) => (
            <div key={d.id} className="rounded-xl border border-gray-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-body text-sm font-semibold text-gray-800">
                  {ETIQUETA_MOTIVO[d.motivo] ?? d.motivo} · {Number(d.total_unidades)} unidad(es)
                </span>
                <span className={`font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  d.reingresa_stock ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                  {d.reingresa_stock ? 'Reingresó a stock' : 'Sin reingreso'}
                </span>
              </div>
              <p className="font-body text-[11px] text-gray-400 mt-0.5">
                {fmt(d.created_at)}{d.registrado_nombre ? ` · ${d.registrado_nombre}` : ''}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {d.items.map((di) => (
                  <li key={di.id} className="font-body text-xs text-gray-600">
                    · {di.producto?.nombre_estandar ?? '—'} — <b>{Number(di.cantidad)}</b>
                  </li>
                ))}
              </ul>
              {d.observacion && <p className="mt-1.5 font-body text-xs text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">{d.observacion}</p>}
            </div>
          ))}
        </div>
      ) : !abierto && (
        <p className="mt-3 font-body text-sm text-gray-400 flex items-center gap-1.5">
          <PackageX className="w-4 h-4 text-gray-300" /> Sin devoluciones registradas.
        </p>
      )}

      {puedeDevolver && devolvibles.length === 0 && devoluciones.length > 0 && (
        <p className="mt-2 font-body text-xs text-gray-400">Ya se devolvió todo lo que salió en este pedido.</p>
      )}
    </div>
  )
}
