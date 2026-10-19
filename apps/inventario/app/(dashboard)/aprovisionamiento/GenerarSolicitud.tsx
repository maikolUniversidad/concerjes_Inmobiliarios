'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList, Plus } from 'lucide-react'
import { formatCOP, miles, PRIORIDAD_META, type PrioridadSolicitud } from '@/lib/solicitudes-compra'
import { generarSolicitudesRecomendacion, type SolicitudGenerada } from '../solicitudes-compra/actions'
import type { RecFila } from './AprovisionamientoTablas'

/**
 * «Generar solicitud» sobre la recomendación de compra en vivo.
 *
 * Se agrupa por proveedor y sale UNA solicitud por proveedor, porque así cada
 * una convierte después a exactamente una orden de compra. El proveedor y el
 * precio los resuelve la base (`v_recomendacion_compra_proveedor`): el
 * comparador de precios cuando hay precio vigente, y el precio de lista del
 * producto cuando no.
 *
 * Los productos sin proveedor (ni en el comparador ni en su ficha) salen en una
 * solicitud aparte. Quedan registrados, que es el punto, pero no se convierten
 * en orden hasta que alguien les asigne proveedor.
 */
export function GenerarSolicitud({ recs, puedeSolicitar }: { recs: RecFila[]; puedeSolicitar: boolean }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set())
  const [prioridad, setPrioridad] = useState<PrioridadSolicitud>('NORMAL')
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [creadas, setCreadas] = useState<SolicitudGenerada[] | null>(null)

  const grupos = useMemo(() => {
    const porProveedor = new Map<string, { nombre: string; filas: RecFila[] }>()
    for (const r of recs) {
      const clave = r.proveedor_sugerido_id ?? '__sin__'
      const nombre = r.proveedor_sugerido ?? 'Sin proveedor'
      const g = porProveedor.get(clave) ?? { nombre, filas: [] }
      g.filas.push(r)
      porProveedor.set(clave, g)
    }
    return [...porProveedor.entries()]
      .map(([clave, g]) => ({
        clave,
        nombre: g.nombre,
        productos: g.filas.length,
        unidades: g.filas.reduce((a, r) => a + Number(r.recomendado), 0),
        valor: g.filas.reduce((a, r) => a + Number(r.valor_estimado ?? 0), 0),
        sinPrecio: g.filas.filter((r) => !r.precio_sugerido).length,
        productoIds: g.filas.map((r) => r.producto_id),
      }))
      .sort((a, b) => (a.clave === '__sin__' ? 1 : b.clave === '__sin__' ? -1 : b.valor - a.valor))
  }, [recs])

  const seleccionados = grupos.filter((g) => !excluidos.has(g.clave))
  const totalValor = seleccionados.reduce((a, g) => a + g.valor, 0)
  const totalProductos = seleccionados.reduce((a, g) => a + g.productos, 0)

  function alternar(clave: string) {
    setExcluidos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  function generar(claves: string[]) {
    const productos = grupos
      .filter((g) => claves.includes(g.clave))
      .flatMap((g) => g.productoIds.map((producto_id) => ({ producto_id })))
    if (productos.length === 0) { setError('No hay productos seleccionados.'); return }
    setError(null)
    iniciar(async () => {
      const res = await generarSolicitudesRecomendacion(productos, prioridad)
      if (res.error) { setError(res.error); return }
      setCreadas(res.solicitudes ?? [])
      router.refresh()
    })
  }

  if (!puedeSolicitar || recs.length === 0) return null

  return (
    <div className="border-t border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="font-body text-xs text-gray-500">
          {grupos.length} proveedor(es) para {recs.length} productos recomendados.
        </p>
        <button type="button" onClick={() => setAbierto((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-brand-green/40 bg-white px-3 py-2 font-body text-sm font-semibold text-brand-green transition-colors hover:bg-green-50">
          <ClipboardList className="h-4 w-4" /> {abierto ? 'Cerrar' : 'Generar solicitud de compra'}
        </button>
      </div>

      {abierto && (
        <div className="space-y-3 border-t border-gray-100 bg-gray-50/60 px-4 py-4">
          <p className="font-body text-xs text-gray-500">
            Sale una solicitud por proveedor: así cada una se convierte después en una sola orden de compra. El precio
            es el del comparador cuando existe y el de lista cuando no.
          </p>

          <ul className="space-y-1.5">
            {grupos.map((g) => (
              <li key={g.clave}
                className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white px-3 py-2 ${
                  g.clave === '__sin__' ? 'border-orange-200' : 'border-gray-200'}`}>
                <label className="flex min-w-[160px] flex-1 items-center gap-2">
                  <input type="checkbox" checked={!excluidos.has(g.clave)} onChange={() => alternar(g.clave)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-green" />
                  <span className="font-body text-sm font-semibold text-gray-900">{g.nombre}</span>
                </label>
                <span className="font-body text-xs text-gray-500">
                  {g.productos} producto(s) · {miles(g.unidades)} uds · {formatCOP(g.valor)}
                  {g.sinPrecio > 0 && <span className="text-orange-600"> · {g.sinPrecio} sin precio</span>}
                </span>
                <button type="button" disabled={pendiente} onClick={() => generar([g.clave])}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-body text-[11px] font-semibold text-gray-600 transition-colors hover:border-brand-green hover:bg-green-50 hover:text-brand-green disabled:opacity-50">
                  <Plus className="h-3 w-3" /> Solo este
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <label className="font-body text-xs text-gray-500">
              Prioridad{' '}
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as PrioridadSolicitud)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm text-gray-900">
                {(Object.keys(PRIORIDAD_META) as PrioridadSolicitud[]).map((p) => (
                  <option key={p} value={p}>{PRIORIDAD_META[p].label}</option>
                ))}
              </select>
            </label>
            <button type="button" disabled={pendiente || seleccionados.length === 0}
              onClick={() => generar(seleccionados.map((g) => g.clave))}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 font-body text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-green-dark disabled:opacity-50">
              <Plus className="h-4 w-4" />
              {pendiente
                ? 'Generando…'
                : `Generar ${seleccionados.length} solicitud(es) · ${totalProductos} productos · ${formatCOP(totalValor)}`}
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700">{error}</p>
          )}

          {creadas && creadas.length > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 font-body text-sm text-green-800">
              {creadas.length} solicitud(es) creada(s):{' '}
              {creadas.map((s) => s.numero).join(', ')}.{' '}
              <Link href="/solicitudes-compra" className="font-semibold underline">Ver solicitudes de compra</Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
