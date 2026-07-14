'use client'

import { cn } from '@/lib/utils'

// Componentes de formulario reutilizables — mobile-first, texto grande, alto
// contacto táctil. Español de Colombia, lenguaje simple.

const base =
  'w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition-colors focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 disabled:bg-gray-100'

export function Label({ children, req }: { children: React.ReactNode; req?: boolean }) {
  return (
    <label className="mb-1.5 block font-body text-sm font-semibold text-gray-700">
      {children} {req && <span className="text-red-500">*</span>}
    </label>
  )
}

export function Field({
  label, req, hint, error, children,
}: {
  label?: string; req?: boolean; hint?: string; error?: string; children: React.ReactNode
}) {
  return (
    <div>
      {label && <Label req={req}>{label}</Label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(base, props.className)} />
}

export function Select({
  children, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(base, 'appearance-none', props.className)}>
      {children}
    </select>
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(base, 'min-h-24 resize-y', props.className)} />
}

/** Selector Sí / No grande y táctil (para baja alfabetización digital). */
export function SiNo({
  value, onChange, incluyeNA,
}: {
  value: boolean | null | undefined
  onChange: (v: boolean | null) => void
  incluyeNA?: boolean
}) {
  const opt = (label: string, v: boolean | null, active: boolean) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={cn(
        'flex-1 rounded-xl border px-4 py-3 font-body text-base font-semibold transition-colors',
        active
          ? 'border-brand-green bg-brand-green text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:border-brand-green'
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="flex gap-2">
      {opt('Sí', true, value === true)}
      {opt('No', false, value === false)}
      {incluyeNA && opt('No aplica', null, value === null)}
    </div>
  )
}

/** Grupo de opciones multi-selección (chips). */
export function Chips({
  opciones, value, onChange,
}: {
  opciones: string[]; value: string[]; onChange: (v: string[]) => void
}) {
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const active = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={cn(
              'rounded-full border px-4 py-2 font-body text-sm font-medium transition-colors',
              active
                ? 'border-brand-green bg-brand-green text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-brand-green'
            )}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 }) {
  return (
    <div className={cn('grid gap-4', cols === 2 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
      {children}
    </div>
  )
}

export function SeccionTitulo({ n, titulo, desc }: { n: number; titulo: string; desc?: string }) {
  return (
    <div className="mb-1">
      <h3 className="flex items-center gap-2 font-heading text-lg font-bold text-gray-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green/10 text-sm text-brand-green">
          {n}
        </span>
        {titulo}
      </h3>
      {desc && <p className="ml-9 mt-0.5 text-sm text-gray-500">{desc}</p>}
    </div>
  )
}
