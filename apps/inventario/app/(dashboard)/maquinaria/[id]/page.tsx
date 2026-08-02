import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { MaquinariaDetalleClient, type MaqDetalle, type MaqEvento, type SedeOpt } from './MaquinariaDetalleClient'

export const metadata: Metadata = { title: 'Maquinaria' }
export const dynamic = 'force-dynamic'

export default async function MaquinariaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermiso('ver_maquinaria')
  const { id } = await params
  const supabase = await createClient()
  const perm = await getPermisosUsuario()

  const { data: maquina } = await supabase
    .from('maquinaria')
    .select('id, codigo, nombre, tipo, marca, modelo, serial, estado, ubicacion_sede_id, ubicacion_texto, responsable, imagen_url, fecha_adquisicion, valor, observaciones, created_at, sedes:ubicacion_sede_id(id, nombre)')
    .eq('id', id)
    .single()
  if (!maquina) notFound()

  const [{ data: eventos }, { data: sedes }] = await Promise.all([
    supabase.from('maquinaria_eventos').select('id, tipo, estado_anterior, estado_nuevo, ubicacion, descripcion, foto_path, usuario_nombre, usuario_email, created_at').eq('maquinaria_id', id).order('created_at', { ascending: false }),
    supabase.from('sedes').select('id, nombre').order('nombre'),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <Link href="/maquinaria" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm">
        <ArrowLeft className="w-4 h-4" /> Maquinaria
      </Link>
      <MaquinariaDetalleClient
        maquina={maquina as unknown as MaqDetalle}
        eventos={(eventos as unknown as MaqEvento[]) ?? []}
        sedes={(sedes as unknown as SedeOpt[]) ?? []}
        puedeGestionar={perm.puede('gestionar_maquinaria')}
      />
    </div>
  )
}
