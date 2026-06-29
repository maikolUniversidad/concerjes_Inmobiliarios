import type { Metadata } from 'next'
import { History } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { HistorialClient, type CambioRow } from './HistorialClient'

export const metadata: Metadata = { title: 'Historial de cambios' }
export const revalidate = 0

export default async function HistorialPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('historial_cambios')
    .select('id, tabla, registro_id, accion, datos_anteriores, datos_nuevos, campos_cambiados, usuario_email, origen, created_at')
    .order('created_at', { ascending: false })
    .limit(300)

  const cambios = (data as unknown as CambioRow[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <History className="w-6 h-6 text-brand-green" /> Historial de cambios
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Versionado automático de todo el sistema — quién cambió qué, cuándo, y los valores antes/después.
        </p>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando historial: {error.message}
        </div>
      ) : (
        <HistorialClient cambios={cambios} />
      )}
    </div>
  )
}
