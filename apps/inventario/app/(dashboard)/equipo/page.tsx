import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { EquipoBuscar, type EquipoRow } from './EquipoBuscar'

export const metadata: Metadata = { title: 'Escanear equipo' }
export const dynamic = 'force-dynamic'

export default async function EquipoPage() {
  const perm = await getPermisosUsuario()
  if (!perm.puede('reportar_falla_maquinaria') && !perm.puede('ver_mantenimiento')) redirect('/dashboard')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: yo }, equipos] = await Promise.all([
    sb.from('usuarios').select('sede_id, sedes:sede_id(id, nombre)').eq('id', user?.id).maybeSingle(),
    traerTodo<EquipoRow>((desde, hasta) => sb.from('maquinaria')
      .select('id, codigo, nombre, tipo, marca, modelo, serial, estado, condicion, imagen_url, proximo_mant, ubicacion_sede_id, ubicacion_texto, sedes:ubicacion_sede_id(nombre), mantenimiento_tickets(id, estado)')
      .eq('activo', true)
      .order('codigo').order('id').range(desde, hasta), { etiqueta: 'Equipos' }),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <ScanLine className="w-6 h-6 text-brand-green" /> Escanear equipo
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Escanea el QR pegado en la máquina o búscala en el inventario para ver su información, reportar una falla o registrar una actividad.
        </p>
      </div>
      <EquipoBuscar sede={(yo?.sedes ?? null) as { id: string; nombre: string } | null} equipos={equipos} />
    </div>
  )
}
