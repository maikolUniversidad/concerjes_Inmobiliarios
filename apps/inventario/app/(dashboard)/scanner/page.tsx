import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import type { CategoriaRotacion } from '@/lib/types/database'
import { ScannerClient, type ScannerProducto } from './ScannerClient'

export const metadata: Metadata = { title: 'Buscador' }
export const revalidate = 30

interface Raw {
  id: string
  ref: number | null
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: CategoriaRotacion
  imagen_url: string | null
  stock_minimo_def: number
  stock: { cantidad_real: number; cantidad_disp: number } | null
}

export default async function ScannerPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('productos')
    .select('id, ref, codigo, nombre_estandar, presentacion, cat_rotacion, imagen_url, stock_minimo_def, stock ( cantidad_real, cantidad_disp )')
    .eq('activo', true)
    .order('nombre_estandar')

  const productos: ScannerProducto[] = ((data as unknown as Raw[]) ?? []).map(p => ({
    id: p.id, ref: p.ref, codigo: p.codigo, nombre: p.nombre_estandar,
    presentacion: p.presentacion, cat: p.cat_rotacion, imagen_url: p.imagen_url,
    minimo: p.stock_minimo_def ?? 0, real: p.stock?.cantidad_real ?? 0,
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Buscador de productos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Escribe el nombre, REF o código — las coincidencias aparecen al instante
        </p>
      </div>
      <ScannerClient productos={productos} />
    </div>
  )
}
