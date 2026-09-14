import type { Metadata } from 'next'
import { HardHat } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { TableroClient, type TicketFila, type EquipoAlerta, type Backlog } from './TableroClient'
import { rangoPeriodo, PERIODOS, type Periodo } from './periodos'

export const metadata: Metadata = { title: 'Mantenimiento' }
export const dynamic = 'force-dynamic'

export default async function MantenimientoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermiso('ver_mantenimiento')
  const perm = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  const sp = await searchParams
  const periodo: Periodo = PERIODOS.some((p) => p.k === sp.periodo) ? sp.periodo as Periodo : 'mes'
  const rango = rangoPeriodo(periodo, sp.desde, sp.hasta)

  const SELECT = 'id, numero, tipo, prioridad, estado, titulo, reportado_nombre, asignado_a, asignado_nombre, created_at, recibido_at, iniciado_at, resuelto_at, cerrado_at, programado_para, ultimo_mensaje_at, costo, maquinaria:maquinaria_id(id, codigo, nombre), sede:sede_id(id, nombre)'
  const enRango = (q: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (rango.desde) q = q.gte('created_at', rango.desde)
    if (rango.hasta) q = q.lt('created_at', rango.hasta)
    return q
  }
  const limiteAlerta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  const [tickets, activos, equipos] = await Promise.all([
    traerTodo<TicketFila>((desde, hasta) => enRango(sb.from('mantenimiento_tickets').select(SELECT))
      .order('created_at', { ascending: false }).order('id').range(desde, hasta), { etiqueta: 'Tickets' }),
    // Pendientes de cualquier fecha: el trabajo por hacer no depende del periodo.
    traerTodo<{ estado: string; prioridad: string; asignado_a: string | null }>((desde, hasta) => sb.from('mantenimiento_tickets')
      .select('estado, prioridad, asignado_a').in('estado', ['ABIERTO', 'RECIBIDO', 'EN_PROCESO', 'EN_ESPERA', 'RESUELTO'])
      .order('id').range(desde, hasta), { etiqueta: 'Pendientes' }),
    traerTodo<EquipoAlerta>((desde, hasta) => sb.from('maquinaria')
      .select('id, codigo, nombre, estado, condicion, proximo_mant, sedes:ubicacion_sede_id(nombre)')
      .eq('activo', true).neq('estado', 'BAJA')
      .or(`estado.in.(DANADA,MANTENIMIENTO),condicion.eq.MALA,proximo_mant.lte.${limiteAlerta}`)
      .order('codigo').order('id').range(desde, hasta), { etiqueta: 'Equipos' }),
  ])

  const backlog: Backlog = {
    porRecibir: activos.filter((t) => t.estado === 'ABIERTO').length,
    enCurso: activos.filter((t) => ['RECIBIDO', 'EN_PROCESO', 'EN_ESPERA'].includes(t.estado)).length,
    criticos: activos.filter((t) => t.estado !== 'RESUELTO' && (t.prioridad === 'CRITICA' || t.prioridad === 'ALTA')).length,
    porConfirmar: activos.filter((t) => t.estado === 'RESUELTO').length,
    mios: activos.filter((t) => t.estado !== 'RESUELTO' && t.asignado_a === user?.id).length,
  }

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
        key={`${periodo}-${sp.desde ?? ''}-${sp.hasta ?? ''}-${sp.vista ?? ''}`}
        tickets={tickets}
        backlog={backlog}
        equipos={equipos}
        periodo={periodo}
        desde={sp.desde ?? ''}
        hasta={sp.hasta ?? ''}
        etiquetaPeriodo={rango.etiqueta}
        vistaInicial={sp.vista}
        usuarioId={user?.id ?? ''}
        permisos={{
          tecnico: perm.puede('atender_mantenimiento') || perm.puede('gestionar_mantenimiento'),
          jefe: perm.puede('gestionar_mantenimiento'),
        }}
      />
    </div>
  )
}
