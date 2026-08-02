import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { PresentacionesClient, type PresRow } from './PresentacionesClient'

export const metadata: Metadata = { title: 'Presentaciones de insumo' }
export const dynamic = 'force-dynamic'

export default async function PresentacionesPage() {
  await requirePermiso('ver_configuracion')
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  const { data } = await supabase
    .from('presentaciones')
    .select('id, nombre, activo')
    .order('nombre')

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Presentaciones de insumo</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Catálogo de presentaciones (Galón, Litro, Caja x 12, Unidad…) para elegir al crear productos.
        </p>
      </div>
      <PresentacionesClient
        presentaciones={(data ?? []) as unknown as PresRow[]}
        puedeEditar={perm.puede('editar_configuracion') || perm.puede('editar_productos')}
      />
    </div>
  )
}
