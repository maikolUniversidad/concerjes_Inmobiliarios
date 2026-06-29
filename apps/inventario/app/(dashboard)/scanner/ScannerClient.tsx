'use client'
import { useState } from 'react'
import { QrCode, Search, Loader2, Package, ArrowLeftRight } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'

interface Resultado {
  id: string
  ref: number | null
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: CategoriaRotacion
  imagen_url: string | null
  stock_minimo_def: number
  stock: { cantidad_real: number; cantidad_disp: number } | null
}

export function ScannerClient() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)

  async function buscar(e: React.FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (!term) return
    setLoading(true)
    const supabase = createClient()
    const esNumero = /^\d+$/.test(term)
    let query = supabase
      .from('productos')
      .select('id, ref, codigo, nombre_estandar, presentacion, cat_rotacion, imagen_url, stock_minimo_def, stock ( cantidad_real, cantidad_disp )')
      .eq('activo', true)
      .limit(20)

    query = esNumero
      ? query.or(`ref.eq.${term},codigo.eq.${term}`)
      : query.ilike('nombre_estandar', `%${term}%`)

    const { data } = await query
    setResultados((data as unknown as Resultado[]) ?? [])
    setLoading(false)
  }

  return (
    <div className="space-y-5">
      <form onSubmit={buscar} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3 border-2 border-gray-200 rounded-xl px-4 py-3 focus-within:border-brand-green transition-colors">
          <QrCode className="w-5 h-5 text-brand-green shrink-0" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
            placeholder="Escanea o escribe REF, código o nombre del producto..."
            className="font-body text-base flex-1 outline-none placeholder:text-gray-400"
          />
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar
          </button>
        </div>
        <p className="font-body text-xs text-gray-400 mt-2">
          Compatible con lectores de código de barras USB (actúan como teclado) y búsqueda manual.
        </p>
      </form>

      {resultados !== null && (
        resultados.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="font-body text-sm">No se encontró ningún producto para “{q}”.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {resultados.map(p => {
              const cat = CATEGORIA_LABELS[p.cat_rotacion]
              const real = p.stock?.cantidad_real ?? 0
              const critico = p.stock_minimo_def > 0 && real <= p.stock_minimo_def
              return (
                <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex gap-4">
                  <div className="w-20 h-20 rounded-xl bg-gray-50 overflow-hidden shrink-0 relative">
                    {p.imagen_url
                      ? <Image src={p.imagen_url} alt={p.nombre_estandar} fill className="object-cover" sizes="80px" />
                      : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-gray-400">REF {p.ref ?? p.codigo ?? '—'}</span>
                      <span className={`font-body font-bold text-xs px-1.5 py-0.5 rounded ${cat.bg} ${cat.color}`}>{p.cat_rotacion}</span>
                    </div>
                    <p className="font-body font-semibold text-sm text-gray-900 truncate">{p.nombre_estandar}</p>
                    <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className={`font-heading font-bold text-lg ${critico ? 'text-red-600' : 'text-gray-900'}`}>
                        {real} <span className="font-body text-xs font-normal text-gray-400">en stock</span>
                      </span>
                      <div className="flex gap-2">
                        <Link href={`/productos/${p.id}`} className="font-body text-xs text-brand-green hover:underline">Ver</Link>
                        <Link href="/movimientos/nuevo" className="inline-flex items-center gap-1 font-body text-xs text-gray-500 hover:text-brand-green">
                          <ArrowLeftRight className="w-3 h-3" /> Movimiento
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
