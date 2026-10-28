import type { Metadata } from 'next'
import { MessageSquareWarning } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { SELECT_PQRS_LISTA, type PqrsFila } from '@/lib/pqrs'
import { ListaPqrs } from './ListaPqrs'

export const metadata: Metadata = { title: 'PQRS' }
export const dynamic = 'force-dynamic'

/** Coordinación: asigna responsable, mueve prioridad y plazo, responde y cierra. */
const ROLES_COORDINACION = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']

export default async function PqrsPage() {
  const perm = await requirePermiso('ver_pqrs')
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()

  // La RLS decide el alcance: el personal de sede solo ve su sede.
  const filas = await traerTodo<PqrsFila>((desde, hasta) => sb.from('pqrs')
    .select(SELECT_PQRS_LISTA)
    .order('created_at', { ascending: false }).order('id').range(desde, hasta), { etiqueta: 'PQRS' })

  const coordina = perm.puede('gestionar_pqrs') && ROLES_COORDINACION.includes(perm.rol)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <MessageSquareWarning className="w-6 h-6 text-brand-green" /> PQRS
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {coordina
            ? 'Peticiones, quejas, reclamos, sugerencias y felicitaciones de todas las sedes · se actualiza en vivo'
            : 'Peticiones, quejas, reclamos, sugerencias y felicitaciones de tu sede'}
        </p>
      </div>
      <ListaPqrs
        filas={filas.map((p) => ({ ...p, dias_plazo: Number(p.dias_plazo) }))}
        usuarioId={user?.id ?? ''}
        puedeRadicar={perm.puede('gestionar_pqrs')}
        verIndicadores={perm.puede('ver_panel_gerencia')}
        puedeParametrizar={perm.puede('parametrizar_pqrs')}
      />
    </div>
  )
}
