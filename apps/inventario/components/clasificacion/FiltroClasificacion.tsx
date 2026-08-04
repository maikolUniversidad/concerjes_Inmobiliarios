'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import { TIPO_CONTRATO_META, TIPO_CONTRATO_OPCIONES, colorEtiqueta, type Categoria, type Etiqueta } from '@/lib/clasificacion'

/**
 * Filtro por clasificación de contrato (tipo Directo/Privado + etiquetas).
 * Escribe el estado en la URL (?tipo=&etq=a,b) para que la página servidor
 * filtre. Reutilizable por Movimientos, Reportes, Aprovisionamiento, Órdenes.
 */
export function FiltroClasificacion({ categorias, etiquetas }: { categorias: Categoria[]; etiquetas: Etiqueta[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const tipo = (sp.get('tipo') ?? '').toUpperCase()
  const etq = (sp.get('etq') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const activo = !!tipo || etq.length > 0

  function aplicar(next: { tipo?: string | null; etq?: string[] }) {
    const params = new URLSearchParams(sp.toString())
    if ('tipo' in next) { next.tipo ? params.set('tipo', next.tipo) : params.delete('tipo') }
    if ('etq' in next) { next.etq && next.etq.length ? params.set('etq', next.etq.join(',')) : params.delete('etq') }
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggleEtq(cat: Categoria, id: string) {
    const enCat = etiquetas.filter(e => e.categoria_id === cat.id).map(e => e.id)
    let next: string[]
    if (etq.includes(id)) next = etq.filter(x => x !== id)
    else if (cat.multiple) next = [...etq, id]
    else next = [...etq.filter(x => !enCat.includes(x)), id]
    aplicar({ etq: next })
  }

  const conValores = categorias.filter(c => etiquetas.some(e => e.categoria_id === c.id))

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-body font-semibold text-xs text-gray-500 uppercase tracking-wide">
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filtrar por contrato
        </span>
        {activo && (
          <button onClick={() => router.push(pathname)} className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-red-600">
            <X className="w-3 h-3" /> Limpiar
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-body text-[11px] text-gray-400">Tipo:</span>
        {TIPO_CONTRATO_OPCIONES.map(o => (
          <button key={o.value} onClick={() => aplicar({ tipo: tipo === o.value ? null : o.value })}
            className={`rounded-full border px-2.5 py-0.5 font-body text-xs font-semibold transition-all ${
              tipo === o.value ? `${TIPO_CONTRATO_META[o.value].badge} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>{o.label}</button>
        ))}
      </div>

      {conValores.map(cat => (
        <div key={cat.id} className="flex flex-wrap items-center gap-1.5">
          <span className="font-body text-[11px] text-gray-400">{cat.nombre}:</span>
          {etiquetas.filter(e => e.categoria_id === cat.id).map(e => {
            const sel = etq.includes(e.id)
            const c = colorEtiqueta(e.color ?? cat.color)
            return (
              <button key={e.id} onClick={() => toggleEtq(cat, e.id)}
                className={`rounded-full border px-2.5 py-0.5 font-body text-xs transition-all ${
                  sel ? `${c.badge} border-transparent font-semibold` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>{e.nombre}</button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
