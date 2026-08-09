'use client'

/** Miniatura del producto (foto) para los listados de ítems de las órdenes. */
export function ProductoThumb({ url, nombre }: { url?: string | null; nombre?: string | null }) {
  return (
    <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-100">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre ?? ''} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm">📦</div>
      )}
    </div>
  )
}
