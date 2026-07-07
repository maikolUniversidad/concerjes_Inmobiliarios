import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { GRUPO_LABELS, type GrupoContrato } from '@/lib/types/database'
import { SedesClient, type GrupoOpt, type SedeRow } from './SedesClient'

export const metadata: Metadata = { title: 'Contratos / Sedes' }
export const revalidate = 30

interface Grupo { id: string; codigo: GrupoContrato; nombre: string; descripcion: string | null }
interface SedeRaw {
  id: string; nombre: string; zona: string | null; ciudad: string; codigo_interno: string | null
  grupo_id: string; grupo: { codigo: GrupoContrato } | null
}

export default async function ContratosPage() {
  await requirePermiso('ver_contratos')
  const supabase = await createClient()
  const [{ data: gruposData }, { data: sedesData }] = await Promise.all([
    supabase.from('grupos_contrato').select('id, codigo, nombre, descripcion').eq('activo', true).order('codigo'),
    supabase.from('sedes').select('id, nombre, zona, ciudad, codigo_interno, grupo_id, grupo:grupos_contrato ( codigo )').eq('activo', true).order('nombre'),
  ])

  const grupos = (gruposData as Grupo[]) ?? []
  const sedesRaw = (sedesData as unknown as SedeRaw[]) ?? []
  const sedes: SedeRow[] = sedesRaw.map(s => ({
    id: s.id, nombre: s.nombre, zona: s.zona, ciudad: s.ciudad,
    codigo_interno: s.codigo_interno, grupo_id: s.grupo_id, grupo_codigo: s.grupo?.codigo ?? null,
  }))
  const gruposOpt: GrupoOpt[] = grupos.map(g => ({ id: g.id, codigo: g.codigo, nombre: g.nombre }))
  const countByGrupo = (codigo: GrupoContrato) => sedes.filter(s => s.grupo_codigo === codigo).length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Contratos y Sedes</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {grupos.length} grupos de contrato · {sedes.length} sedes activas
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {grupos.map(g => {
          const meta = GRUPO_LABELS[g.codigo]
          return (
            <div key={g.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className={`font-heading font-bold text-sm px-2.5 py-1 rounded-lg ${meta?.color ?? 'bg-gray-100 text-gray-700'}`}>{g.nombre}</span>
                <span className="font-body text-xs text-gray-400">{countByGrupo(g.codigo)} sedes</span>
              </div>
              <p className="font-body text-sm text-gray-600 leading-relaxed">{g.descripcion}</p>
            </div>
          )
        })}
      </div>

      <SedesClient grupos={gruposOpt} sedes={sedes} />
    </div>
  )
}
