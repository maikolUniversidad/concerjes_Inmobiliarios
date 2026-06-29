import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Share2 } from 'lucide-react'
import { GrafoRelaciones } from './GrafoRelaciones'

export const metadata: Metadata = { title: 'Grafo de relaciones' }

export default function GrafoPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/reportes" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a reportes
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <Share2 className="w-6 h-6 text-brand-green" /> Grafo de relaciones
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Mapa interactivo del modelo de datos: cada nodo es una tabla y cada línea una relación (clave foránea).
        </p>
      </div>
      <GrafoRelaciones />
    </div>
  )
}
