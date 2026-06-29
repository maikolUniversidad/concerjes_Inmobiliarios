import type { Metadata } from 'next'
import { Building2, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { GRUPO_LABELS, type GrupoContrato } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Contratos / Sedes' }
export const revalidate = 60

interface Grupo { id: string; codigo: GrupoContrato; nombre: string; descripcion: string | null }
interface SedeRow {
  id: string; nombre: string; zona: string | null; ciudad: string; codigo_interno: string | null
  grupo: { codigo: GrupoContrato } | null
}

export default async function ContratosPage() {
  const supabase = await createClient()
  const [{ data: gruposData }, { data: sedesData }] = await Promise.all([
    supabase.from('grupos_contrato').select('id, codigo, nombre, descripcion').eq('activo', true).order('codigo'),
    supabase.from('sedes').select('id, nombre, zona, ciudad, codigo_interno, grupo:grupos_contrato ( codigo )').eq('activo', true).order('nombre'),
  ])

  const grupos = (gruposData as Grupo[]) ?? []
  const sedes = (sedesData as unknown as SedeRow[]) ?? []
  const countBySrupo = (codigo: GrupoContrato) => sedes.filter(s => s.grupo?.codigo === codigo).length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Contratos y Sedes</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {grupos.length} grupos de contrato · {sedes.length} sedes activas
        </p>
      </div>

      {/* Grupos */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {grupos.map(g => {
          const meta = GRUPO_LABELS[g.codigo]
          return (
            <div key={g.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className={`font-heading font-bold text-sm px-2.5 py-1 rounded-lg ${meta?.color ?? 'bg-gray-100 text-gray-700'}`}>
                  {g.nombre}
                </span>
                <span className="font-body text-xs text-gray-400">{countBySrupo(g.codigo)} sedes</span>
              </div>
              <p className="font-body text-sm text-gray-600 leading-relaxed">{g.descripcion}</p>
            </div>
          )
        })}
      </div>

      {/* Sedes */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Sedes / contratos cliente</h2>
        </div>
        {sedes.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="font-body text-sm">No hay sedes registradas todavía.</p>
            <p className="font-body text-xs mt-1">Se cargan desde el Excel maestro (hojas C.A., M.O., M.B., P.B., A.D.).</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Sede</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Grupo</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Zona</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Ciudad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sedes.map(s => {
                  const meta = s.grupo ? GRUPO_LABELS[s.grupo.codigo] : null
                  return (
                    <tr key={s.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-body font-medium text-sm text-gray-900">{s.nombre}</p>
                        {s.codigo_interno && <p className="font-body text-xs text-gray-400">N° {s.codigo_interno}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {meta && <span className={`font-body text-xs px-2 py-0.5 rounded-full ${meta.color}`}>{meta.nombre}</span>}
                      </td>
                      <td className="px-4 py-3 font-body text-sm text-gray-500">{s.zona ?? '—'}</td>
                      <td className="px-4 py-3 font-body text-sm text-gray-500">{s.ciudad}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
