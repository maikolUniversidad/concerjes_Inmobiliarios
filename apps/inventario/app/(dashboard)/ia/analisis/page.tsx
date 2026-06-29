import type { Metadata } from 'next'
import Link from 'next/link'
import { BarChart3, TrendingUp, Brain } from 'lucide-react'

export const metadata: Metadata = { title: 'Análisis IA' }

export default function AnalisisIAPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Análisis IA</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Predicción de consumo y optimización de compras
        </p>
      </div>

      <div className="bg-gradient-to-br from-brand-green to-brand-green-mid rounded-2xl p-8 text-white shadow-sm">
        <TrendingUp className="w-6 h-6 text-green-200 mb-3" />
        <h2 className="font-heading font-bold text-xl mb-2">Anticipa tus necesidades de reabastecimiento</h2>
        <p className="font-body text-sm text-green-100 leading-relaxed max-w-xl">
          A partir del histórico de rotación y consumo por grupo de contrato, la IA (DeepSeek Reasoner)
          proyectará la demanda y sugerirá cantidades óptimas de compra. Función en integración.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/reportes" className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <BarChart3 className="w-5 h-5 text-brand-green mb-2" />
          <h3 className="font-heading font-semibold text-gray-900">Reportes en vivo</h3>
          <p className="font-body text-sm text-gray-500 mt-1">Indicadores actuales del inventario.</p>
        </Link>
        <Link href="/ia/asistente" className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <Brain className="w-5 h-5 text-brand-green mb-2" />
          <h3 className="font-heading font-semibold text-gray-900">Asistente IA</h3>
          <p className="font-body text-sm text-gray-500 mt-1">Consulta el inventario en lenguaje natural.</p>
        </Link>
      </div>
    </div>
  )
}
