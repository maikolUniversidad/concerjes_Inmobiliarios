'use client'
import { useMemo, useState } from 'react'
import { Search, Package, Eye, ArrowLeftRight, SlidersHorizontal, X } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'

export interface ScannerProducto {
  id: string
  ref: number | null
  codigo: number | null
  nombre: string
  presentacion: string | null
  cat: CategoriaRotacion
  imagen_url: string | null
  minimo: number
  real: number
}

function normaliza(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

const MAX = 40

export function ScannerClient({ productos }: { productos: ScannerProducto[] }) {
  const [q, setQ] = useState('')

  const { resultados, totalCoincidencias } = useMemo(() => {
    const term = normaliza(q.trim())
    if (!term) return { resultados: [], totalCoincidencias: 0 }
    // Cada token debe coincidir (búsqueda multi-palabra)
    const tokens = term.split(/\s+/)
    const matches = productos.filter(p => {
      const haystack = `${normaliza(p.nombre)} ${p.ref ?? ''} ${p.codigo ?? ''} ${normaliza(p.presentacion ?? '')}`
      return tokens.every(t => haystack.includes(t))
    })
    return { resultados: matches.slice(0, MAX), totalCoincidencias: matches.length }
  }, [q, productos])

  return (
    <div className="space-y-5">
      {/* Buscador */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm sticky top-2 z-10">
        <div className="flex items-center gap-3 border-2 border-gray-200 rounded-xl px-4 py-3 focus-within:border-brand-green transition-colors">
          <Search className="w-5 h-5 text-brand-green shrink-0" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
            placeholder="Escribe nombre, REF o código..."
            className="font-body text-base flex-1 outline-none placeholder:text-gray-400"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-gray-300 hover:text-gray-500" title="Limpiar">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        {q && (
          <p className="font-body text-xs text-gray-400 mt-2">
            {totalCoincidencias === 0 ? 'Sin coincidencias' :
              `${totalCoincidencias} coincidencia${totalCoincidencias === 1 ? '' : 's'}${totalCoincidencias > MAX ? ` · mostrando ${MAX}` : ''}`}
          </p>
        )}
      </div>

      {/* Estado vacío inicial */}
      {!q && (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <Search className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-500">Empieza a escribir para buscar</p>
          <p className="font-body text-sm mt-1">{productos.length} productos en el catálogo · compatible con lectores de código de barras USB</p>
        </div>
      )}

      {/* Resultados */}
      {q && totalCoincidencias === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-gray-400">
          <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="font-body text-sm">No se encontró ningún producto para “{q}”.</p>
        </div>
      )}

      {resultados.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {resultados.map(p => {
            const cat = CATEGORIA_LABELS[p.cat]
            const critico = p.minimo > 0 && p.real <= p.minimo
            return (
              <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-brand-green/30 transition-all flex gap-4">
                <Link href={`/productos/${p.id}`} className="w-20 h-20 rounded-xl bg-gray-50 overflow-hidden shrink-0 relative block">
                  {p.imagen_url
                    ? <Image src={p.imagen_url} alt={p.nombre} fill className="object-cover" sizes="80px" />
                    : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>}
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-gray-400">REF {p.ref ?? p.codigo ?? '—'}</span>
                    <span className={`font-body font-bold text-xs px-1.5 py-0.5 rounded ${cat.bg} ${cat.color}`}>{p.cat}</span>
                  </div>
                  <Link href={`/productos/${p.id}`} className="font-body font-semibold text-sm text-gray-900 line-clamp-2 hover:text-brand-green">{p.nombre}</Link>
                  <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className={`font-heading font-bold text-lg ${critico ? 'text-red-600' : 'text-gray-900'}`}>
                      {p.real} <span className="font-body text-xs font-normal text-gray-400">en stock</span>
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Link href={`/productos/${p.id}`} title="Ver detalle"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 transition-colors">
                        <Eye className="w-4 h-4" />
                      </Link>
                      <Link href={`/movimientos/nuevo?producto=${p.id}`} title="Registrar movimiento"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors">
                        <ArrowLeftRight className="w-4 h-4" />
                      </Link>
                      <Link href={`/movimientos/nuevo?producto=${p.id}&tipo=AJUSTE`} title="Ajustar unidades"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                        <SlidersHorizontal className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
