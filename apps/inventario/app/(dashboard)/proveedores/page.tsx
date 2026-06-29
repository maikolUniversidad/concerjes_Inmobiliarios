import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ProveedoresClient, type ProveedorRow } from './ProveedoresClient'

export const metadata: Metadata = { title: 'Proveedores' }
export const revalidate = 30

export default async function ProveedoresPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('proveedores')
    .select('id, nombre, nit, contacto, telefono, email, logo_url, es_principal')
    .eq('activo', true)
    .order('es_principal', { ascending: false })
    .order('nombre')

  const proveedores = (data as ProveedorRow[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Proveedores</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {proveedores.length} proveedores activos · {proveedores.filter(p => p.es_principal).length} principales
        </p>
      </div>
      <ProveedoresClient proveedores={proveedores} />
    </div>
  )
}
