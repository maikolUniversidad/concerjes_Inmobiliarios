import type { Metadata } from 'next'
import Link from 'next/link'
import { Sparkles, Camera, Brain } from 'lucide-react'

export const metadata: Metadata = { title: 'Visión IA' }

export default function VisionIAPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Visión IA</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Reconocimiento de productos a partir de fotografías
        </p>
      </div>

      <div className="bg-gradient-to-br from-brand-green to-brand-green-mid rounded-2xl p-8 text-white shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Camera className="w-6 h-6 text-green-200" />
          <Sparkles className="w-5 h-5 text-green-200" />
        </div>
        <h2 className="font-heading font-bold text-xl mb-2">Identifica insumos con una foto</h2>
        <p className="font-body text-sm text-green-100 leading-relaxed max-w-xl">
          Sube una imagen de un producto y la IA (GPT-4o Vision) lo identificará, sugiriendo
          el insumo del catálogo, su categoría y presentación. Función en integración.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-brand-green" />
          <h3 className="font-heading font-semibold text-gray-900">Mientras tanto</h3>
        </div>
        <p className="font-body text-sm text-gray-600 mb-4">
          Puedes consultar el inventario en lenguaje natural con el Asistente IA, ya disponible.
        </p>
        <Link href="/ia/asistente"
          className="inline-block bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors">
          Abrir Asistente IA
        </Link>
      </div>
    </div>
  )
}
