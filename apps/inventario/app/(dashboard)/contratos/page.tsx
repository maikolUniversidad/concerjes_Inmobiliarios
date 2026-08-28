import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { type GrupoContrato } from '@/lib/types/database'
import type { Categoria, Etiqueta, TipoContrato } from '@/lib/clasificacion'
import { SedesClient, type GrupoOpt, type SedeRow } from './SedesClient'
import { GruposClasificacion, EtiquetasManager, type GrupoClasif } from './Clasificacion'

export const metadata: Metadata = { title: 'Contratos / Sedes' }
export const dynamic = 'force-dynamic'

interface Grupo {
  id: string; codigo: GrupoContrato; nombre: string; descripcion: string | null
  tipo_contrato: TipoContrato | null; grupo_etiquetas?: { etiqueta_id: string }[] | null
}
interface SedeRaw {
  id: string; nombre: string; zona: string | null; ciudad: string; codigo_interno: string | null
  grupo_id: string; grupo: { codigo: GrupoContrato } | null
  direccion?: string | null; lat?: number | null; lng?: number | null
  tipo_contrato?: TipoContrato | null; sede_etiquetas?: { etiqueta_id: string }[] | null
}

export default async function ContratosPage() {
  await requirePermiso('ver_contratos')
  const supabase = await createClient()
  const [{ data: gruposData }, { data: sedesData }, { data: catsData }, { data: etsData }] = await Promise.all([
    supabase.from('grupos_contrato').select('id, codigo, nombre, descripcion, tipo_contrato, grupo_etiquetas ( etiqueta_id )').eq('activo', true).order('codigo'),
    traerTodo((desde, hasta) => supabase.from('sedes').select('*, grupo:grupos_contrato ( codigo ), sede_etiquetas ( etiqueta_id )').eq('activo', true).order('nombre').order('id').range(desde, hasta)).then((data) => ({ data })),
    supabase.from('etiqueta_categorias').select('id, nombre, descripcion, color, multiple, orden').eq('activo', true).order('orden'),
    supabase.from('etiquetas').select('id, categoria_id, nombre, color, orden').eq('activo', true).order('orden'),
  ])

  const grupos = (gruposData as unknown as Grupo[]) ?? []
  const sedesRaw = (sedesData as unknown as SedeRaw[]) ?? []
  const categorias = (catsData as Categoria[]) ?? []
  const etiquetas = (etsData as Etiqueta[]) ?? []

  const gruposById = new Map(grupos.map(g => [g.id, g]))
  const sedes: SedeRow[] = sedesRaw.map(s => ({
    id: s.id, nombre: s.nombre, zona: s.zona, ciudad: s.ciudad,
    codigo_interno: s.codigo_interno, grupo_id: s.grupo_id, grupo_codigo: s.grupo?.codigo ?? null,
    grupo_nombre: gruposById.get(s.grupo_id)?.nombre ?? null,
    direccion: s.direccion ?? null, lat: s.lat ?? null, lng: s.lng ?? null,
    tipo_contrato: s.tipo_contrato ?? null,
    etiquetaIds: (s.sede_etiquetas ?? []).map(e => e.etiqueta_id),
  }))
  const gruposOpt: GrupoOpt[] = grupos.map(g => ({ id: g.id, codigo: g.codigo, nombre: g.nombre }))
  const gruposClasif: GrupoClasif[] = grupos.map(g => ({
    id: g.id, codigo: g.codigo, nombre: g.nombre, descripcion: g.descripcion,
    tipo_contrato: g.tipo_contrato ?? null, etiquetaIds: (g.grupo_etiquetas ?? []).map(e => e.etiqueta_id),
  }))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Contratos y Sedes</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {grupos.length} grupos de contrato · {sedes.length} sedes activas · clasifícalos por tipo (Directo/Privado) y etiquetas
        </p>
      </div>

      <EtiquetasManager categorias={categorias} etiquetas={etiquetas} />

      <GruposClasificacion grupos={gruposClasif} categorias={categorias} etiquetas={etiquetas} />

      <SedesClient grupos={gruposOpt} sedes={sedes} categorias={categorias} etiquetas={etiquetas} />
    </div>
  )
}
