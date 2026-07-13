import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { PersonasClient } from './PersonasClient'

export const metadata: Metadata = { title: 'Personas · Gestión Humana' }
export const dynamic = 'force-dynamic'

export default async function PersonasPage() {
  await requirePermiso('ver_personas')
  const supabase = await createClient()

  const [{ data: personas }, { data: empresas }, { data: sedes }, { data: roles }] = await Promise.all([
    supabase
      .from('personas')
      .select(`
        id, tipo_doc, documento, nombres, apellidos, cargo, empresa_usuaria_id, sede_id,
        fecha_ingreso, estado, email, telefono, direccion, eps, arl, usuario_id, created_at,
        empresas_usuarias ( id, nombre ),
        sedes ( id, nombre ),
        cuenta:usuarios ( id, email, activo, rol_id, roles ( id, nombre ) )
      `)
      .order('apellidos', { ascending: true }),
    supabase.from('empresas_usuarias').select('*').order('nombre'),
    supabase.from('sedes').select('id, nombre').order('nombre'),
    supabase.from('roles').select('id, nombre, descripcion, permisos').eq('activo', true).order('nombre'),
  ])

  // Claves existentes para el cargue masivo (formato de validarFila: `documento:<valor>`)
  const existentes = (personas ?? []).map(
    (p: { documento: string }) => `documento:${String(p.documento).trim().toLowerCase()}`,
  )

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Personas</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Colaboradores y su empresa usuaria asignada · {(personas ?? []).length} registrados
        </p>
      </div>

      <PersonasClient
        personas={personas ?? []}
        empresas={empresas ?? []}
        sedes={sedes ?? []}
        roles={roles ?? []}
        existentes={existentes}
      />
    </div>
  )
}
