'use client'

import { useState } from 'react'

/**
 * Lista de opciones con una salida para lo que no está: «Otro…» cambia a un
 * campo de texto. Un valor guardado que no está en la lista se muestra como
 * texto, así no se pierde lo que ya había.
 */
export function SelectConOtro({
  value, onChange, opciones, placeholder = 'Seleccione…', className = '', disabled = false, etiquetaOtro = 'Otro…',
}: {
  value: string
  onChange: (v: string) => void
  opciones: string[]
  placeholder?: string
  className?: string
  disabled?: boolean
  etiquetaOtro?: string
}) {
  const fueraDeLista = !!value && !opciones.includes(value)
  const [escribiendo, setEscribiendo] = useState(fueraDeLista)

  if (escribiendo || fueraDeLista) {
    return (
      <div className="relative">
        <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="Escriba cuál"
          className={className + ' pr-14'} autoFocus={escribiendo && !value} />
        {!disabled && (
          <button type="button" onClick={() => { setEscribiendo(false); onChange('') }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-brand-green hover:bg-brand-green/10"
            title="Volver a la lista">
            Lista
          </button>
        )}
      </div>
    )
  }
  return (
    <select value={value} disabled={disabled} className={className}
      onChange={(e) => {
        if (e.target.value === '__otro__') { setEscribiendo(true); onChange(''); return }
        onChange(e.target.value)
      }}>
      <option value="">{placeholder}</option>
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__otro__">{etiquetaOtro}</option>
    </select>
  )
}
