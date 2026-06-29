import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ArqueoNuevoForm } from './ArqueoNuevoForm'

export const metadata: Metadata = { title: 'Nuevo arqueo' }

export default function NuevoArqueoPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/arqueo" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a arqueos
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Nuevo arqueo</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Inicia una sesión de conteo físico de inventario</p>
      </div>
      <ArqueoNuevoForm />
    </div>
  )
}
