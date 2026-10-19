import type { Metadata } from 'next'
import { ListChecks } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { CatalogoClient, type TipoFila } from './CatalogoClient'

export const metadata: Metadata = { title: 'Catálogo de actividades' }
export const dynamic = 'force-dynamic'

export default async function CatalogoRondasPage() {
  await requirePermiso('ver_catalogo_rondas')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // La RLS decide el alcance: el catálogo general (grupo_id NULL) lo ve todo el
  // mundo con el permiso; los de un contrato, solo quien alcanza ese contrato.
  // Orden estable (orden, codigo, id) porque `traerTodo` pagina con OFFSET.
  const [tipos, contratos] = await Promise.all([
    traerTodo<TipoFila>((desde, hasta) => sb.from('ronda_tipos_actividad')
      .select(`id, grupo_id, codigo, nombre, descripcion, categoria, icono, color, orden, activo,
               contrato:grupos_contrato ( codigo, nombre ),
               ronda_plantillas ( count )`)
      .order('orden').order('codigo').order('id').range(desde, hasta),
      { etiqueta: 'tipos de actividad' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('grupos_contrato').select('id, codigo, nombre')
        .order('codigo').order('id').range(desde, hasta), { etiqueta: 'contratos' }),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-brand-green" /> Catálogo de actividades
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {tipos.length} actividades · qué clases de trabajo existen en los puntos de control.
          Se agregan desde aquí: no hacen falta cambios en el sistema.
        </p>
      </div>

      <CatalogoClient
        tipos={tipos}
        contratos={contratos}
        puedeGestionar={permisos.puede('gestionar_catalogo_rondas')}
      />
    </div>
  )
}
