import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { DocumentosClient } from './DocumentosClient'
import { Info } from 'lucide-react'

export const metadata: Metadata = { title: 'Documentos y Galería' }
export const revalidate = 0

export default async function DocumentosPage() {
  await requirePermiso('ver_documentos')
  const supabase = await createClient()

  const [{ data: sst }, { data: galeria }] = await Promise.all([
    supabase.storage.from('documentos-sst').list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
    supabase.storage.from('galeria-fotos').list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
  ])

  return (
    <div className="p-5 sm:p-6 space-y-6 max-w-5xl">

      {/* Header */}
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Documentos y Galería</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Archivos públicos que se muestran en el sitio web de Conserjes Inmobiliarios
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="font-body text-sm text-blue-700 leading-relaxed">
          Los archivos que subas aquí serán <strong>públicos</strong> y visibles en la landing page de la empresa.
          Los documentos SST aparecen como descargables en la sección de Seguridad y Salud.
          Las fotos de galería se muestran en la sección de Galería del sitio web.
        </p>
      </div>

      <DocumentosClient
        sstInicial={(sst ?? []) as Parameters<typeof DocumentosClient>[0]['sstInicial']}
        galeriaInicial={(galeria ?? []) as Parameters<typeof DocumentosClient>[0]['galeriaInicial']}
      />
    </div>
  )
}
