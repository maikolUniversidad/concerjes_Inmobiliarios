import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import CodigosClient from './CodigosClient'

export const metadata: Metadata = { title: 'Generador de Códigos' }
export const revalidate = 0

export default async function CodigosPage() {
  const supabase = await createClient()

  const { data: productos } = await supabase
    .from('productos')
    .select('id, codigo, ref, nombre_estandar, presentacion, codigo_barras, codigo_barras_formato, codigo_barras_origen')
    .eq('activo', true)
    .order('nombre_estandar')
    .limit(500)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Generador de Códigos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Genera códigos de barras o QR y asígnalos a tus productos
        </p>
      </div>
      <CodigosClient productos={productos ?? []} />
    </div>
  )
}
