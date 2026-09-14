import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { EquipoBuscar, type EquipoSedeRow } from './EquipoBuscar'

export const metadata: Metadata = { title: 'Escanear equipo' }
export const dynamic = 'force-dynamic'

export default async function EquipoPage() {
  const perm = await getPermisosUsuario()
  if (!perm.puede('reportar_falla_maquinaria') && !perm.puede('ver_mantenimiento')) redirect('/dashboard')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: yo } = await sb.from('usuarios').select('sede_id, sedes:sede_id(id, nombre)').eq('id', user?.id).maybeSingle()
  const sede = (yo?.sedes ?? null) as { id: string; nombre: string } | null

  let equipos: EquipoSedeRow[] = []
  if (sede) {
    const { data } = await sb.from('maquinaria')
      .select('id, codigo, nombre, tipo, estado, condicion, imagen_url, proximo_mant, mantenimiento_tickets(id, estado)')
      .eq('ubicacion_sede_id', sede.id).eq('activo', true).neq('estado', 'BAJA')
      .order('codigo')
    equipos = (data ?? []) as EquipoSedeRow[]
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <ScanLine className="w-6 h-6 text-brand-green" /> Escanear equipo
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Escanea el QR pegado en la máquina o escribe su código para ver su información, reportar una falla o registrar una actividad.
        </p>
      </div>
      <EquipoBuscar sede={sede} equipos={equipos} />
    </div>
  )
}
