import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { NuevaOrdenClient, type SedeOpt, type BodegaOpt, type UsuarioOpt } from './NuevaOrdenClient'

export const metadata: Metadata = { title: 'Nueva orden de insumo' }
export const dynamic = 'force-dynamic'

export default async function NuevaOrdenPage() {
  await requirePermiso('crear_ordenes_insumo')
  const supabase = await createClient()

  const [{ data: sedes }, { data: bodegas }, { data: usuarios }] = await Promise.all([
    supabase.from('sedes').select('id, nombre, grupo:grupos_contrato ( nombre )').eq('activo', true).order('nombre'),
    supabase.from('bodegas').select('id, nombre').order('nombre'),
    supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedesOpt: SedeOpt[] = ((sedes ?? []) as any[]).map((s) => ({ id: s.id, nombre: s.nombre, grupo: s.grupo?.nombre ?? null }))

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Nueva orden de insumo</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Elige la sede: se cargan sus productos parametrizados con la cantidad máxima permitida.
        </p>
      </div>
      <NuevaOrdenClient
        sedes={sedesOpt}
        bodegas={(bodegas ?? []) as unknown as BodegaOpt[]}
        usuarios={(usuarios ?? []) as unknown as UsuarioOpt[]}
      />
    </div>
  )
}
