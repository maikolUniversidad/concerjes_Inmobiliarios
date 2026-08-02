import type { Metadata } from 'next'
import { Wrench } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { MaquinariaClient, type MaquinariaRow, type SedeOpt } from './MaquinariaClient'

export const metadata: Metadata = { title: 'Maquinaria' }
export const dynamic = 'force-dynamic'

export default async function MaquinariaPage() {
  await requirePermiso('ver_maquinaria')
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  const [{ data: maquinas }, { data: sedes }] = await Promise.all([
    supabase.from('maquinaria')
      .select('id, codigo, nombre, tipo, marca, modelo, serial, estado, ubicacion_sede_id, ubicacion_texto, responsable, imagen_url, fecha_adquisicion, valor, observaciones, created_at, sedes:ubicacion_sede_id(id, nombre)')
      .order('codigo'),
    supabase.from('sedes').select('id, nombre').order('nombre'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <Wrench className="w-6 h-6 text-brand-green" /> Maquinaria
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Control de equipos: estado, ubicación, fotos y trazabilidad · {(maquinas ?? []).length} registradas
        </p>
      </div>

      <MaquinariaClient
        maquinas={(maquinas as unknown as MaquinariaRow[]) ?? []}
        sedes={(sedes as unknown as SedeOpt[]) ?? []}
        puedeGestionar={perm.puede('gestionar_maquinaria')}
      />
    </div>
  )
}
