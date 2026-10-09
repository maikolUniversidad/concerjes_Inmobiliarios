import type { Metadata } from 'next'
import { Bug } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { ListaSoporte, type TicketSoporteFila } from './ListaSoporte'

export const metadata: Metadata = { title: 'Soporte' }
export const dynamic = 'force-dynamic'

// Sin permiso de página: todos ven sus propios tickets; la RLS deja ver los de
// todos solo a quien tiene `ver_tickets_soporte` o `gestionar_soporte`.
export default async function SoportePage() {
  const perm = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  const agente = perm.puede('ver_tickets_soporte') || perm.puede('gestionar_soporte')

  const tickets = await traerTodo<TicketSoporteFila>((desde, hasta) => sb.from('soporte_tickets')
    .select('id, numero, tipo, prioridad, estado, titulo, modulo, reportado_por, reportado_nombre, asignado_a, asignado_nombre, created_at, updated_at, ultimo_mensaje_at')
    .order('created_at', { ascending: false }).order('id').range(desde, hasta), { etiqueta: 'Tickets de soporte' })

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <Bug className="w-6 h-6 text-brand-green" /> Soporte
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {agente
            ? 'Errores, solicitudes de soporte y propuestas de mejora de todos los usuarios · se actualiza en vivo'
            : 'Tus reportes de errores, solicitudes de soporte y propuestas de mejora'}
        </p>
      </div>
      <ListaSoporte tickets={tickets} usuarioId={user?.id ?? ''} agente={agente} />
    </div>
  )
}
