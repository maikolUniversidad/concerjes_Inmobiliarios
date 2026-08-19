'use client'

import { useMemo, useState } from 'react'
import { Search, Package, Check } from 'lucide-react'

export interface ProductoComboItem { id: string; nombre_estandar: string; presentacion: string | null; codigo?: number | null }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

/**
 * Selector de producto con búsqueda inteligente: al escribir muestra las
 * coincidencias (sin tildes, multi-palabra, por nombre/presentación/código).
 */
export function ProductoCombo({
  productos, value, onPick, placeholder = '— Selecciona un producto —', excluir = [],
}: {
  productos: ProductoComboItem[]
  value: string
  onPick: (p: ProductoComboItem) => void
  placeholder?: string
  excluir?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const sel = productos.find(p => p.id === value) ?? null

  const filtradas = useMemo(() => {
    const excl = new Set(excluir)
    const base = productos.filter(p => !excl.has(p.id) || p.id === value)
    const query = norm(q.trim())
    if (!query) return base.slice(0, 20)
    const tokens = query.split(/\s+/)
    return base.filter(p => {
      const hay = norm(`${p.nombre_estandar} ${p.presentacion ?? ''} ${p.codigo ?? ''}`)
      return tokens.every(t => hay.includes(t))
    }).slice(0, 20)
  }, [productos, q, value, excluir])

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-sm text-left outline-none focus:border-brand-green bg-white">
        <span className={`truncate ${sel ? 'text-gray-800' : 'text-gray-400'}`}>
          {sel ? `${sel.nombre_estandar}${sel.presentacion ? ` · ${sel.presentacion}` : ''}` : placeholder}
        </span>
        <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQ('') }} />
          <div className="absolute z-30 mt-1 w-full min-w-[240px] rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Escribe para buscar…"
                className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400" />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtradas.length === 0 ? (
                <p className="px-3 py-3 font-body text-sm text-gray-400">Sin resultados para «{q.trim()}».</p>
              ) : filtradas.map(p => (
                <button key={p.id} type="button"
                  onClick={() => { onPick(p); setOpen(false); setQ('') }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-green-50 ${p.id === value ? 'bg-green-50/60' : ''}`}>
                  <Package className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-body text-sm text-gray-800 truncate">{p.nombre_estandar}</span>
                    {p.presentacion && <span className="block font-body text-xs text-gray-400">{p.presentacion}</span>}
                  </span>
                  {p.id === value && <Check className="w-4 h-4 text-brand-green shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
