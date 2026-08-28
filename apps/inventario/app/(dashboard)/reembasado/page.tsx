import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { ReembasadoClient } from './ReembasadoClient'

export const metadata: Metadata = { title: 'Reembasado' }
export const dynamic = 'force-dynamic'

export default async function ReembasadoPage() {
  await requirePermiso('ver_reembasado')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const [{ data: recetas }, productos, stock] = await Promise.all([
    sb.from('reembasados').select(`
      id, nombre, descripcion, cantidad_origen, activo, producto_origen_id, created_at,
      origen:producto_origen_id ( id, nombre_estandar, presentacion, ref ),
      items:reembasado_items ( id, cantidad, producto_destino_id,
        destino:producto_destino_id ( id, nombre_estandar, presentacion, ref ) )
    `).order('created_at', { ascending: false }),
    // Paginados: catálogo y stock se necesitan completos (PostgREST: 1.000/resp.)
    traerTodo<never>((desde, hasta) => sb.from('productos')
      .select('id, nombre_estandar, presentacion, ref').eq('activo', true)
      .order('nombre_estandar').order('id').range(desde, hasta)),
    traerTodo<never>((desde, hasta) => sb.from('stock')
      .select('producto_id, cantidad_disp').order('producto_id').range(desde, hasta)),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Reembasado / Decantado</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Convierte un producto grande en varios pequeños (o al revés) y controla el stock automáticamente.
        </p>
      </div>
      <ReembasadoClient
        recetas={recetas ?? []}
        productos={productos}
        stock={stock}
      />
    </div>
  )
}
