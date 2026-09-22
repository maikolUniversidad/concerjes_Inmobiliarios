'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  titulo, subtitulo, onClose, children, pie, ancho = 'max-w-2xl',
}: {
  titulo: ReactNode; subtitulo?: ReactNode; onClose: () => void; children: ReactNode; pie?: ReactNode; ancho?: string
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative flex max-h-[94vh] w-full ${ancho} flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl`}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-bold text-gray-900">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-xs text-gray-500">{subtitulo}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && <div className="shrink-0 border-t border-gray-100 bg-gray-50/60 px-5 py-3">{pie}</div>}
      </div>
    </div>
  )
}

export function Seccion({ titulo, icono, acciones, children }: { titulo: ReactNode; icono?: ReactNode; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-heading text-sm font-bold text-gray-800">{icono}{titulo}</h3>
        {acciones}
      </div>
      {children}
    </section>
  )
}

export function Dato({ label, valor, ancho }: { label: string; valor: ReactNode; ancho?: boolean }) {
  const vacio = valor === null || valor === undefined || valor === ''
  return (
    <div className={ancho ? 'sm:col-span-2' : ''}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={'text-sm ' + (vacio ? 'text-gray-300' : 'text-gray-800')}>{vacio ? '—' : valor}</p>
    </div>
  )
}

export const inputCls =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15 disabled:bg-gray-50'

export function Campo({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
}

export function Boton({
  children, onClick, variante = 'primario', disabled, type = 'button', className = '', title,
}: {
  children: ReactNode; onClick?: () => void; variante?: 'primario' | 'secundario' | 'peligro' | 'suave'
  disabled?: boolean; type?: 'button' | 'submit'; className?: string; title?: string
}) {
  const v = {
    primario: 'bg-brand-green text-white hover:bg-brand-green-dark',
    secundario: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
    peligro: 'bg-red-600 text-white hover:bg-red-700',
    suave: 'bg-brand-green/10 text-brand-green hover:bg-brand-green/15',
  }[variante]
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
}

export const fechaCorta = (s: string | null | undefined) =>
  s ? new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const fechaHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
