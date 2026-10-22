import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardList, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { ESTADO_PLANTILLA_META, type EstadoPlantilla } from '@/lib/ronda/pasos'
import { NuevaPlantilla } from './NuevaPlantilla'

export const metadata: Metadata = { title: 'Plantillas de tarea' }
export const dynamic = 'force-dynamic'

interface PlantillaRaw {
  id: string
  grupo_id: string | null
  codigo: string
  version: number
  nombre: string
  estado: EstadoPlantilla
  duracion_estimada_min: number | null
  publicada_at: string | null
  tipo: { codigo: string; nombre: string; color: string | null } | null
  contrato: { codigo: string } | null
  ronda_plantilla_pasos: { count: number }[] | null
}

export default async function PlantillasPage() {
  await requirePermiso('ver_catalogo_rondas')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Orden estable: por código, versión descendente e id, porque `traerTodo`
  // pagina con OFFSET y sin orden único se pueden repetir filas.
  const [plantillas, tipos, contratos] = await Promise.all([
    traerTodo<PlantillaRaw>((desde, hasta) => sb.from('ronda_plantillas')
      .select(`id, grupo_id, codigo, version, nombre, estado, duracion_estimada_min, publicada_at,
               tipo:ronda_tipos_actividad ( codigo, nombre, color ),
               contrato:grupos_contrato ( codigo ),
               ronda_plantilla_pasos ( count )`)
      .order('codigo').order('version', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'plantillas' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('ronda_tipos_actividad').select('id, codigo, nombre').eq('activo', true)
        .order('orden').order('codigo').order('id').range(desde, hasta), { etiqueta: 'actividades' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('grupos_contrato').select('id, codigo, nombre')
        .order('codigo').order('id').range(desde, hasta), { etiqueta: 'contratos' }),
  ])

  const publicadas = plantillas.filter((p) => p.estado === 'PUBLICADA').length
  const borradores = plantillas.filter((p) => p.estado === 'BORRADOR').length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-green" /> Plantillas de tarea
          </h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {plantillas.length} versiones · {publicadas} publicadas · {borradores} en borrador.
            Una plantilla publicada queda congelada: para cambiarla se saca una versión nueva,
            y las respuestas que ya se guardaron siguen apuntando a la versión con la que se contestaron.
          </p>
        </div>
        {permisos.puede('gestionar_catalogo_rondas') && (
          <NuevaPlantilla tipos={tipos} contratos={contratos} />
        )}
      </div>

      {plantillas.length === 0 ? (
        <p className="font-body text-sm text-gray-500 rounded-lg border border-gray-200 bg-white p-6">
          Todavía no hay plantillas. Una plantilla es una actividad paso a paso: qué se revisa,
          qué foto se toma, qué se mide y quién firma.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Plantilla</th>
                <th className="px-4 py-2.5 hidden sm:table-cell">Actividad</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 hidden md:table-cell">Ámbito</th>
                <th className="px-4 py-2.5 hidden lg:table-cell text-right">Pasos</th>
                <th className="px-4 py-2.5 hidden lg:table-cell text-right">Minutos</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plantillas.map((p) => {
                const meta = ESTADO_PLANTILLA_META[p.estado]
                return (
                  <tr key={p.id} className={p.estado === 'ARCHIVADA' ? 'bg-gray-50/60' : undefined}>
                    <td className="px-4 py-3">
                      <Link href={`/rondas/plantillas/${p.id}`}
                        className="font-body text-sm font-semibold text-gray-900 hover:text-brand-green">
                        {p.nombre}
                      </Link>
                      <p className="font-body text-xs text-gray-400">{p.codigo} · versión {p.version}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell font-body text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: p.tipo?.color ?? '#9ca3af' }} />
                        {p.tipo?.nombre ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell font-body text-sm text-gray-600">
                      {p.contrato?.codigo ?? <span className="text-gray-400">Todos</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell font-body text-sm text-gray-600 text-right tabular-nums">
                      {Number(p.ronda_plantilla_pasos?.[0]?.count ?? 0)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell font-body text-sm text-gray-600 text-right tabular-nums">
                      {p.duracion_estimada_min ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/rondas/plantillas/${p.id}`}
                        className="inline-flex text-gray-400 hover:text-brand-green">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
