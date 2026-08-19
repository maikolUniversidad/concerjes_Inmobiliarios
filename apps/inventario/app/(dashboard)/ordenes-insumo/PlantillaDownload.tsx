'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, X, Search, Check, Loader2 } from 'lucide-react'

export interface SedeItem {
  id: string
  nombre: string
  grupo: string | null
}

export function PlantillaDownload({ sedes, misSedes }: { sedes: SedeItem[]; misSedes: string[] }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(misSedes))
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtradas = sedes.filter(s =>
    s.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (s.grupo ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const selAll  = () => setSelected(new Set(sedes.map(s => s.id)))
  const selMias = () => setSelected(new Set(misSedes))
  const clearSel = () => setSelected(new Set())

  async function descargar() {
    setLoading(true)
    setError(null)
    try {
      const params = selected.size > 0
        ? '?sedes=' + Array.from(selected).join(',')
        : ''
      const res = await fetch(`/api/plantilla-pedido${params}`)
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = res.headers.get('Content-Disposition')
        ?.match(/filename="([^"]+)"/)?.[1] ?? 'plantilla_pedido.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al generar la plantilla')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-brand-green/50 hover:bg-green-50 text-gray-700 font-body font-semibold text-sm px-3 py-2 rounded-xl shadow-sm transition-colors">
        <Download className="w-4 h-4 text-brand-green" />
        Plantilla Excel
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 bg-white border border-gray-200 rounded-2xl shadow-xl w-80">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div>
              <p className="font-heading font-bold text-sm text-gray-900">Descargar plantilla</p>
              <p className="font-body text-xs text-gray-400 mt-0.5">
                Selecciona las sedes a incluir como columnas
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Acciones rápidas */}
          <div className="flex gap-1.5 px-4 pb-2">
            {misSedes.length > 0 && (
              <button onClick={selMias}
                className="font-body text-xs text-brand-green hover:underline">
                Mis sedes ({misSedes.length})
              </button>
            )}
            <button onClick={selAll}
              className="font-body text-xs text-gray-500 hover:underline">
              Todas
            </button>
            <button onClick={clearSel}
              className="font-body text-xs text-gray-500 hover:underline">
              Limpiar
            </button>
            <span className="ml-auto font-body text-xs text-gray-400">{selected.size} selec.</span>
          </div>

          {/* Buscador */}
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar sede…"
                className="flex-1 bg-transparent font-body text-sm text-gray-700 placeholder-gray-400 outline-none"
              />
            </div>
          </div>

          {/* Lista de sedes */}
          <div className="max-h-56 overflow-y-auto px-2 pb-2">
            {filtradas.length === 0 && (
              <p className="font-body text-xs text-gray-400 text-center py-4">Sin resultados</p>
            )}
            {filtradas.map(s => (
              <button key={s.id}
                onClick={() => toggle(s.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-colors ${selected.has(s.id) ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected.has(s.id) ? 'bg-brand-green border-brand-green' : 'border-gray-300'}`}>
                  {selected.has(s.id) && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-body text-sm text-gray-800 truncate block">{s.nombre}</span>
                  {s.grupo && <span className="font-body text-xs text-gray-400">{s.grupo}</span>}
                </span>
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
              <p className="font-body text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-3">
            <button
              onClick={descargar}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark disabled:opacity-60 text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando…</>
                : <><Download className="w-4 h-4" /> Descargar Excel</>}
            </button>
            <p className="font-body text-[11px] text-gray-400 text-center mt-2">
              Hoja «Todos» con todas juntas + una hoja por contrato · Hoja «Productos» con stock
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
