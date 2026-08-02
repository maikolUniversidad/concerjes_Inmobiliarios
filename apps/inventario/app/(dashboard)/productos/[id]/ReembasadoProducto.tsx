'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Split, Play, Plus, ArrowRight, Package, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { EjecutarModal, etiqueta, type Receta } from '../../reembasado/ReembasadoClient'

/* eslint-disable @typescript-eslint/no-explicit-any */
// Sección embebida en la ficha del producto: recetas de reembasado donde ESTE
// producto es el origen. Se ejecuta con el mismo modal del módulo.
export function ReembasadoProducto({ productoId }: { productoId: string }) {
  const { puede } = usePermisos()
  const gestiona = puede('gestionar_reembasado')
  const [sb] = useState<any>(() => createClient())
  const [recetas, setRecetas] = useState<Receta[]>([])
  const [dispOrigen, setDispOrigen] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [ejecutar, setEjecutar] = useState<Receta | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [{ data: recs }, { data: st }] = await Promise.all([
        sb.from('reembasados').select(`
          id, nombre, descripcion, cantidad_origen, activo, producto_origen_id,
          origen:producto_origen_id ( id, nombre_estandar, presentacion, ref ),
          items:reembasado_items ( id, cantidad, producto_destino_id,
            destino:producto_destino_id ( id, nombre_estandar, presentacion, ref ) )
        `).eq('producto_origen_id', productoId).eq('activo', true),
        sb.from('stock').select('cantidad_disp').eq('producto_id', productoId).maybeSingle(),
      ])
      if (!vivo) return
      setRecetas((recs ?? []) as Receta[])
      setDispOrigen(Number(st?.cantidad_disp ?? 0))
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [productoId, sb])

  if (cargando) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-brand-green" /></div>
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-heading text-base font-bold text-gray-900">
          <Split className="h-4 w-4 text-brand-green" /> Reembasado
        </h3>
        {gestiona && (
          <Link href="/reembasado" className="flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline">
            <Plus className="h-3.5 w-3.5" /> Crear receta
          </Link>
        )}
      </div>

      {recetas.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-400">
          Este producto no tiene recetas de reembasado.
          {gestiona && <> Créalas en el módulo <Link href="/reembasado" className="text-brand-green underline">Reembasado</Link>.</>}
        </p>
      ) : (
        <div className="space-y-2">
          {recetas.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">{r.nombre}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                  <Package className="h-3.5 w-3.5" /> {Number(r.cantidad_origen)} <ArrowRight className="h-3 w-3" />
                  {r.items.map((it, i) => (
                    <span key={i} className="rounded bg-brand-green/5 px-1.5 py-0.5 text-brand-green-dark">
                      {Number(it.cantidad)} × {it.destino?.nombre_estandar ?? '—'}
                    </span>
                  ))}
                </p>
              </div>
              {gestiona && (
                <button onClick={() => setEjecutar(r)}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-green-dark">
                  <Play className="h-3.5 w-3.5" /> Reembasar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {ejecutar && (
        <EjecutarModal
          sb={sb} receta={ejecutar} dispOrigen={dispOrigen}
          onCerrar={() => setEjecutar(null)}
          onHecho={(veces) => { setDispOrigen((d) => d - ejecutar.cantidad_origen * veces); setEjecutar(null) }}
        />
      )}
    </div>
  )
}
