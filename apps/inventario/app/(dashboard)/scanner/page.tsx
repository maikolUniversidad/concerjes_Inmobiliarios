import type { Metadata } from 'next'
import { ScannerClient } from './ScannerClient'

export const metadata: Metadata = { title: 'Escáner' }

export default function ScannerPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Escáner de productos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Localiza un producto al instante por código de barras, REF o nombre
        </p>
      </div>
      <ScannerClient />
    </div>
  )
}
