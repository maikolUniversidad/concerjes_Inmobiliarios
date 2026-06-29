import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import type { CategoriaRotacion } from '@/lib/types/database'
import { StockClient, type StockRow } from './StockClient'

export const metadata: Metadata = { title: 'Stock' }
export const revalidate = 15

interface Row {
  id: string
  ref: number | null
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: CategoriaRotacion
  stock_minimo_def: number
  stock: { cantidad_real: number; cantidad_disp: number; cantidad_entr: number; cantidad_sal: number } | null
}

export default async function StockPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('productos')
    .select('id, ref, nombre_estandar, presentacion, cat_rotacion, stock_minimo_def, stock ( cantidad_real, cantidad_disp, cantidad_entr, cantidad_sal )')
    .eq('activo', true)
    .order('ref', { ascending: false })

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando stock: {error.message}
        </div>
      </div>
    )
  }

  const rows: StockRow[] = (data as unknown as Row[] ?? []).map(p => ({
    id: p.id,
    ref: p.ref,
    nombre: p.nombre_estandar,
    presentacion: p.presentacion,
    cat: p.cat_rotacion,
    real: p.stock?.cantidad_real ?? 0,
    disp: p.stock?.cantidad_disp ?? 0,
    entrante: p.stock?.cantidad_entr ?? 0,
    saliente: p.stock?.cantidad_sal ?? 0,
    minimo: p.stock_minimo_def ?? 0,
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Stock en Tiempo Real</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Inventario actual · cantidad real, disponible, entrante y saliente
        </p>
      </div>
      <StockClient rows={rows} />
    </div>
  )
}
