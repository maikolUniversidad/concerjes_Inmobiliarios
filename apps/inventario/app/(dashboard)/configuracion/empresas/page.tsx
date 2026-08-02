import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { EmpresasClient, type EmpresaRow } from './EmpresasClient'

export const metadata: Metadata = { title: 'Empresas emisoras' }
export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  await requirePermiso('ver_configuracion')
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  const { data } = await supabase
    .from('empresas_emisoras')
    .select('id, razon_social, nombre_comercial, nit, telefono, email, direccion, ciudad, sitio_web, logo_path, es_predeterminada, activo')
    .order('es_predeterminada', { ascending: false })
    .order('razon_social')

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Empresas emisoras</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Registra las empresas (razón social, datos y logo) que emiten los documentos. La predeterminada se usa por defecto.
        </p>
      </div>
      <EmpresasClient
        empresas={(data ?? []) as unknown as EmpresaRow[]}
        puedeEditar={perm.puede('editar_configuracion')}
      />
    </div>
  )
}
