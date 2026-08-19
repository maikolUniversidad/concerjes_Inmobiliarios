'use client'

import { useMemo } from 'react'
import { ComboBuscador } from './ComboBuscador'

export interface ProductoComboItem {
  id: string
  nombre_estandar: string
  presentacion: string | null
  codigo?: number | null
  imagen_url?: string | null
}

/** Miniatura del producto para la lista de resultados (o un icono si no hay foto). */
function Foto({ url, nombre, size = 'w-8 h-8' }: { url?: string | null; nombre?: string; size?: string }) {
  return (
    <span className={`${size} rounded-md overflow-hidden bg-gray-100 border border-gray-100 shrink-0 inline-flex items-center justify-center`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre ?? ''} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs">📦</span>
      )}
    </span>
  )
}

/**
 * Selector de producto con búsqueda inteligente (sin tildes, multi-palabra, por
 * nombre / presentación / código) y foto del producto en cada resultado.
 */
export function ProductoCombo({
  productos, value, onPick, placeholder = '— Selecciona un producto —', excluir = [], disabled = false,
}: {
  productos: ProductoComboItem[]
  value: string
  onPick: (p: ProductoComboItem) => void
  placeholder?: string
  excluir?: string[]
  disabled?: boolean
}) {
  const disponibles = useMemo(() => {
    if (excluir.length === 0) return productos
    const excl = new Set(excluir)
    return productos.filter(p => !excl.has(p.id) || p.id === value)
  }, [productos, excluir, value])

  return (
    <ComboBuscador
      items={disponibles}
      value={value}
      onPick={onPick}
      disabled={disabled}
      getId={p => p.id}
      textoBusqueda={p => `${p.nombre_estandar} ${p.presentacion ?? ''} ${p.codigo ?? ''}`}
      placeholder={placeholder}
      buscarPlaceholder="Busca por nombre, presentación o código…"
      sinResultados="Ningún producto coincide"
      etiqueta={p => (
        <span className="flex items-center gap-2 min-w-0">
          <Foto url={p.imagen_url} nombre={p.nombre_estandar} size="w-5 h-5" />
          <span className="truncate">{p.nombre_estandar}{p.presentacion ? ` · ${p.presentacion}` : ''}</span>
        </span>
      )}
      fila={p => (
        <span className="flex items-center gap-2.5 min-w-0">
          <Foto url={p.imagen_url} nombre={p.nombre_estandar} />
          <span className="min-w-0">
            <span className="block font-body text-sm text-gray-800 truncate">{p.nombre_estandar}</span>
            <span className="block font-body text-xs text-gray-400 truncate">
              {p.presentacion ?? 'Sin presentación'}{p.codigo ? ` · cód. ${p.codigo}` : ''}
            </span>
          </span>
        </span>
      )}
    />
  )
}
