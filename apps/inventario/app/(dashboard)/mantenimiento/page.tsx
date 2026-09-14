import type { Metadata } from 'next'
import { HardHat } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { TableroClient, type TicketFila, type EquipoAlerta } from './TableroClient'

export const metadata: Metadata = { title: 'Mantenimiento' }
export const dynamic = 'force-dynamic'

export default async function MantenimientoPage() {
  await requirePermiso('ver_mantenimiento')
  const perm = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  // Activos completos + cerrados/cancelados de los últimos 90 días.
  const hace90 = new Date(Date.now() - 90 * 86400000).toISOString()
  const SELECT = 'id, numero, tipo, prioridad, estado, titulo, reportado_nombre, asignado_a, asignado_nombre, created_at, recibido_at, resuelto_at, programado_para, ultimo_mensaje_at, costo, maquinaria:maquinaria_id(id, codigo, nombre), sede:sede_id(id, nombre)'
  const [tickets, equipos] = await Promise.all([
    traerTodo<TicketFila>((desde, hasta) => sb.from('mantenimiento_tickets').select(SELECT)
      .or(`estado.in.(ABIERTO,RECIBIDO,EN_PROCESO,EN_ESPERA,RESUELTO),created_at.gte."${hace90}"`)
      .order('created_at', { ascending: false }).order('id').range(desde, hasta)),
    traerTodo<EquipoAlerta>((desde, hasta) => sb.from('maquinaria')
      .select('id, codigo, nombre, estado, condicion, proximo_mant, sedes:ubicacion_sede_id(nombre)')
      .eq('activo', true).neq('estado', 'BAJA')
      .or(`estado.in.(DANADA,MANTENIMIENTO),condicion.eq.MALA,proximo_mant.lte.${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}`)
      .order('codigo').order('id').range(desde, hasta)),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <HardHat className="w-6 h-6 text-brand-green" /> Mantenimiento
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Reportes de falla, soporte remoto y preventivos de la maquinaria · se actualiza en vivo
        </p>
      </div>
      <TableroClient
        tickets={tickets}
        equipos={equipos}
        usuarioId={user?.id ?? ''}
        permisos={{
          tecnico: perm.puede('atender_mantenimiento') || perm.puede('gestionar_mantenimiento'),
          jefe: perm.puede('gestionar_mantenimiento'),
        }}
      />
    </div>
  )
}
