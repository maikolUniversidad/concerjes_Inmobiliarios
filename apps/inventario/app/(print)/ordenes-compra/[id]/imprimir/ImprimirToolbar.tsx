'use client'

import { Printer, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

/** Barra flotante (no se imprime) con el botón de imprimir / guardar PDF. */
export function ImprimirToolbar({ ocId }: { ocId: string }) {
  return (
    <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur">
      <Link href={`/ordenes-compra/${ocId}`} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-4 h-4" /> Volver a la orden
      </Link>
      <button onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 font-body font-semibold text-sm text-white hover:bg-brand-green-dark">
        <Printer className="w-4 h-4" /> Imprimir / Guardar PDF
      </button>
    </div>
  )
}
