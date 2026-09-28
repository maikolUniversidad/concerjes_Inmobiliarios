import Link from 'next/link'
import { ClipboardCheck, BarChart3, ListChecks, Plus } from 'lucide-react'

/** Cabecera común del módulo de arqueo con las pestañas Conteos / Análisis. */
export function ArqueoTabs({ activa, puedeCrear = false }: { activa: 'conteos' | 'analisis'; puedeCrear?: boolean }) {
  const tabs = [
    { id: 'conteos', href: '/arqueo', label: 'Conteos', icon: ListChecks },
    { id: 'analisis', href: '/arqueo/analisis', label: 'Análisis entre meses', icon: BarChart3 },
  ] as const
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-brand-green" /> Arqueo de inventario
          </h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {activa === 'conteos'
              ? 'Conteos físicos hechos en la plataforma y cargados por Excel, del más reciente al más antiguo.'
              : 'Compara todos los conteos entre meses, sin importar si se hicieron en la plataforma o por cargue masivo.'}
          </p>
        </div>
        {puedeCrear && (
          <Link href="/arqueo/nuevo"
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> Nuevo arqueo
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <Link key={t.id} href={t.href}
            className={`flex items-center gap-1.5 px-3 py-2 font-body text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activa === t.id ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
