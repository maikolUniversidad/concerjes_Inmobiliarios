import type { Metadata } from 'next'
import { BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { InstructivosClient, type InstructivoFila } from './InstructivosClient'

export const metadata: Metadata = { title: 'Instructivos' }
export const dynamic = 'force-dynamic'

export default async function InstructivosPage() {
  await requirePermiso('ver_catalogo_rondas')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [instructivos, tipos, contratos] = await Promise.all([
    traerTodo<InstructivoFila>((desde, hasta) => sb.from('ronda_instructivos')
      .select(`id, grupo_id, tipo_actividad_id, codigo, version, titulo, tipo, momento, idioma,
               archivo_path, mime, tamano, duracion_seg, texto, estado, created_at,
               actividad:ronda_tipos_actividad ( codigo, nombre ),
               contrato:grupos_contrato ( codigo )`)
      .order('codigo').order('version', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'instructivos' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('ronda_tipos_actividad').select('id, codigo, nombre').eq('activo', true)
        .order('orden').order('codigo').order('id').range(desde, hasta), { etiqueta: 'actividades' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('grupos_contrato').select('id, codigo, nombre')
        .order('codigo').order('id').range(desde, hasta), { etiqueta: 'contratos' }),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-brand-green" /> Instructivos
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {instructivos.length} versiones · el material que explica cómo se hace una actividad o un
          paso: foto, video, PDF o audio. Se guarda en un bucket privado y se abre con un enlace
          firmado que caduca en cinco minutos.
        </p>
      </div>

      <InstructivosClient
        instructivos={instructivos}
        actividades={tipos}
        contratos={contratos}
        puedeGestionar={permisos.puede('gestionar_catalogo_rondas')}
      />
    </div>
  )
}
