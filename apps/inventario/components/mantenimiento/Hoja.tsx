'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Hoja modal: panel inferior en móvil, diálogo centrado en escritorio. */
export function Hoja({ abierta, titulo, icono, onClose, children, pie }: {
  abierta: boolean
  titulo: string
  icono?: ReactNode
  onClose: () => void
  children: ReactNode
  pie?: ReactNode
}) {
  useEffect(() => {
    if (!abierta) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abierta, onClose])

  if (!abierta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-4 shrink-0">
          <h2 className="font-heading font-bold text-base text-gray-900 flex items-center gap-2">{icono}{titulo}</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {pie && <div className="border-t border-gray-100 px-5 py-4 shrink-0">{pie}</div>}
      </div>
    </div>
  )
}

export const inputMant =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 bg-white transition-colors'
export const labelMant = 'font-body font-semibold text-xs text-gray-600 block mb-1'
