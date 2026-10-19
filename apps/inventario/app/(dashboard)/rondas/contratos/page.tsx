import type { Metadata } from 'next'
import Link from 'next/link'
import { FileSignature, ChevronRight, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import {
  ESTADO_META, SERVICIO_LABEL, diasParaVencer, estaVigente, textoVigencia,
  type ContratoFila, type EstadoContrato, type ServicioContrato, type VigenciaFila,
} from '@/lib/contratos-conserjeria'

export const metadata: Metadata = { title: 'Contratos de conserjería' }
export const dynamic = 'force-dynamic'

interface GrupoRaw {
  id: string; codigo: string; nombre: string; descripcion: string | null
  objeto: string | null; numero: string | null; cliente_id: string | null
  estado: EstadoContrato | null; vigencia_desde: string | null; vigencia_hasta: string | null
  idioma_reportes: string | null; arte_color: string | null; arte_logo_path: string | null
  activo: boolean | null
  cliente: { nombre: string } | null
  grupo_servicios: { servicio: ServicioContrato; activo: boolean }[] | null
  sedes: { count: number }[] | null
}

export default async function ContratosConserjeriaPage() {
  await requirePermiso('ver_contratos_conserjeria')
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // La RLS decide el alcance: cada quien ve los contratos a los que alcanza
  // (auth_grupos()); un ADMIN ve todos.
  const [grupos, periodos] = await Promise.all([
    traerTodo<GrupoRaw>((desde, hasta) => sb.from('grupos_contrato')
      .select(`id, codigo, nombre, descripcion, objeto, numero, cliente_id, estado,
               vigencia_desde, vigencia_hasta, idioma_reportes, arte_color, arte_logo_path, activo,
               cliente:empresas_usuarias ( nombre ),
               grupo_servicios ( servicio, activo ),
               sedes ( count )`)
      .order('codigo').order('id').range(desde, hasta), { etiqueta: 'contratos conserjería' }),
    traerTodo<VigenciaFila>((desde, hasta) => sb.from('grupo_vigencias')
      .select('id, grupo_id, desde, hasta, tipo, motivo')
      .order('desde', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'vigencias' }),
  ])

  const porGrupo = (id: string) => periodos.filter((p) => p.grupo_id === id)

  const filas: ContratoFila[] = grupos.map((g) => ({
    id: g.id,
    codigo: g.codigo,
    nombre: g.nombre,
    descripcion: g.descripcion,
    objeto: g.objeto,
    numero: g.numero,
    cliente_id: g.cliente_id,
    cliente_nombre: g.cliente?.nombre ?? null,
    estado: g.estado ?? 'BORRADOR',
    vigencia_desde: g.vigencia_desde,
    vigencia_hasta: g.vigencia_hasta,
    idioma_reportes: g.idioma_reportes ?? 'es-CO',
    arte_color: g.arte_color,
    arte_logo_path: g.arte_logo_path,
    activo: g.activo ?? true,
    servicios: (g.grupo_servicios ?? []).filter((s) => s.activo).map((s) => s.servicio),
    sedes: Number(g.sedes?.[0]?.count ?? 0),
  }))

  const vigentes = filas.filter((f) => estaVigente(f, porGrupo(f.id))).length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-brand-green" /> Contratos de conserjería
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {filas.length} contratos · {vigentes} vigentes hoy · el contrato es el eje de la operación:
          de su vigencia y sus reglas dependen los puntos, los QR y las tareas
        </p>
      </div>

      {filas.length === 0 ? (
        <p className="font-body text-sm text-gray-500 rounded-lg border border-gray-200 bg-white p-6">
          No hay contratos en tu alcance. Los contratos se dan de alta en Contratos y Sedes;
          aquí se les configura la vigencia, los servicios y las reglas.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Contrato</th>
                <th className="px-4 py-2.5 hidden sm:table-cell">Cliente</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 hidden md:table-cell">Vigencia</th>
                <th className="px-4 py-2.5 hidden lg:table-cell">Servicios</th>
                <th className="px-4 py-2.5 hidden sm:table-cell text-right">Sedes</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((f) => {
                const per = porGrupo(f.id)
                const dias = diasParaVencer(f, per)
                const meta = ESTADO_META[f.estado]
                const apagado = !estaVigente(f, per)
                return (
                  <tr key={f.id} className={apagado ? 'bg-gray-50/60' : undefined}>
                    <td className="px-4 py-3">
                      <Link href={`/rondas/contratos/${f.id}`}
                        className="font-body text-sm font-semibold text-gray-900 hover:text-brand-green">
                        {f.nombre}
                      </Link>
                      <p className="font-body text-xs text-gray-400">
                        {f.codigo}{f.numero ? ` · nº ${f.numero}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell font-body text-sm text-gray-600">
                      {f.cliente_nombre ?? <span className="text-gray-400">Sin cliente</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell font-body text-sm text-gray-600">
                      {textoVigencia(f, per)}
                      {dias !== null && dias >= 0 && dias <= 60 && (
                        <span className="ml-1.5 inline-flex items-center gap-1 font-body text-[11px] text-amber-700">
                          <AlertTriangle className="w-3 h-3" />{dias} días
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {f.servicios.length === 0
                          ? <span className="font-body text-xs text-gray-400">Sin servicios</span>
                          : f.servicios.map((s) => (
                            <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 font-body text-[11px] text-gray-600">
                              {SERVICIO_LABEL[s]}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell font-body text-sm text-gray-600 text-right tabular-nums">
                      {f.sedes}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/rondas/contratos/${f.id}`} className="inline-flex text-gray-400 hover:text-brand-green">
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
