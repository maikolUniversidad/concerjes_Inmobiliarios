import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { EditorPlantilla, type PasoFila, type PlantillaDetalle } from './EditorPlantilla'

export const metadata: Metadata = { title: 'Editor de plantilla' }
export const dynamic = 'force-dynamic'

export default async function PlantillaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermiso('ver_catalogo_rondas')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: plantilla } = await sb.from('ronda_plantillas')
    .select(`id, grupo_id, tipo_actividad_id, origen_plantilla_id, codigo, version, nombre,
             descripcion, estado, duracion_estimada_min, exige_firma, exige_geocerca,
             publicada_at, contrato:grupos_contrato ( codigo, nombre )`)
    .eq('id', id).maybeSingle()
  // Sin fila puede ser que no exista o que la RLS no la deje ver: para quien
  // consulta es lo mismo, y decir «no existe» no filtra nada.
  if (!plantilla) notFound()

  const [pasos, tipos, instructivos, versiones] = await Promise.all([
    traerTodo<PasoFila>((desde, hasta) => sb.from('ronda_plantilla_pasos')
      .select(`id, orden, tipo, titulo, ayuda, obligatorio, config,
               instructivo_id, instructivo_momento, condicion_paso_id, condicion_valor`)
      .eq('plantilla_id', id).order('orden').order('id').range(desde, hasta),
      { etiqueta: 'pasos' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('ronda_tipos_actividad').select('id, codigo, nombre').eq('activo', true)
        .order('orden').order('codigo').order('id').range(desde, hasta), { etiqueta: 'actividades' }),
    traerTodo<{ id: string; codigo: string; version: number; titulo: string; tipo: string }>(
      (desde, hasta) => sb.from('ronda_instructivos')
        .select('id, codigo, version, titulo, tipo').neq('estado', 'ARCHIVADO')
        .order('codigo').order('version', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'instructivos' }),
    traerTodo<{ id: string; grupo_id: string | null; version: number; estado: string; publicada_at: string | null }>(
      (desde, hasta) => sb.from('ronda_plantillas')
        .select('id, grupo_id, version, estado, publicada_at')
        .eq('codigo', plantilla.codigo)
        .order('version', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'versiones' }),
  ])

  // El mismo código puede existir en el catálogo general Y como ajuste de uno o
  // varios contratos, y cada uno lleva su propia serie de versiones. Se filtra
  // aquí y no en la consulta porque PostgREST no sabe comparar con
  // `IS NOT DISTINCT FROM`, que es lo que hace falta cuando grupo_id es NULL.
  const mismaSerie = versiones.filter((v) => v.grupo_id === plantilla.grupo_id)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Link href="/rondas/plantillas"
        className="inline-flex items-center gap-1 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="w-4 h-4" /> Plantillas de tarea
      </Link>

      <EditorPlantilla
        plantilla={plantilla as PlantillaDetalle}
        pasos={pasos}
        tipos={tipos}
        instructivos={instructivos}
        versiones={mismaSerie}
        puedeGestionar={permisos.puede('gestionar_catalogo_rondas')}
      />
    </div>
  )
}
