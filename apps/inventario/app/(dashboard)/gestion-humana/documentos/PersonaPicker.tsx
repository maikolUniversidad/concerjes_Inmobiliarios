'use client'

import { useMemo, useState } from 'react'
import { Search, User } from 'lucide-react'
import type { PersonaLite } from './DocumentosClient'

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'

interface Props {
  personas: PersonaLite[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}

export function PersonaPicker({ personas, value, onChange, placeholder = 'Selecciona una persona…' }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const sel = personas.find((p) => p.id === value) ?? null
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = t
      ? personas.filter((p) => `${p.nombres} ${p.apellidos} ${p.documento}`.toLowerCase().includes(t))
      : personas
    return base.slice(0, 30)
  }, [personas, q])

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
        <span className={sel ? 'text-gray-800' : 'text-gray-400'}>
          {sel ? `${sel.nombres} ${sel.apellidos} · ${sel.documento}` : placeholder}
        </span>
        <User className="w-4 h-4 text-gray-400 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search className="w-4 h-4 text-gray-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o documento…"
                className="flex-1 bg-transparent text-sm outline-none" />
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              {filtradas.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">Sin resultados</p>}
              {filtradas.map((p) => (
                <button key={p.id} onClick={() => { onChange(p.id); setOpen(false); setQ('') }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green/10 text-brand-green text-xs font-bold shrink-0">
                    {(p.nombres[0] ?? '') + (p.apellidos[0] ?? '')}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-800 truncate">{p.nombres} {p.apellidos}</span>
                    <span className="block text-xs text-gray-400">{p.tipo_doc} {p.documento}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
