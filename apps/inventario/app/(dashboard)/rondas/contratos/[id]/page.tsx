import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import {
  REGLAS_POR_DEFECTO,
  type ContratoFila, type EstadoContrato, type ReglasContrato,
  type ServicioContrato, type VigenciaFila,
} from '@/lib/contratos-conserjeria'
import { EditorContrato } from '../EditorContrato'

export const metadata: Metadata = { title: 'Contrato de conserjería' }
export const dynamic = 'force-dynamic'

interface ClienteOpt { id: string; nombre: string }

export default async function ContratoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const perm = await requirePermiso('ver_contratos_conserjeria')
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: g } = await sb.from('grupos_contrato')
    .select(`id, codigo, nombre, descripcion, objeto, numero, cliente_id, estado,
             vigencia_desde, vigencia_hasta, idioma_reportes, arte_color, arte_logo_path, activo,
             cliente:empresas_usuarias ( nombre ),
             grupo_servicios ( servicio, activo ),
             sedes ( count )`)
    .eq('id', id).maybeSingle()
  if (!g) notFound()

  const [periodos, reglasFila, clientes] = await Promise.all([
    traerTodo<VigenciaFila>((desde, hasta) => sb.from('grupo_vigencias')
      .select('id, grupo_id, desde, hasta, tipo, motivo').eq('grupo_id', id)
      .order('desde', { ascending: false }).order('id').range(desde, hasta),
      { etiqueta: 'vigencias del contrato' }),
    sb.from('grupo_reglas').select('*').eq('grupo_id', id).maybeSingle()
      .then((r: { data: ReglasContrato | null }) => r.data),
    // El catálogo de clientes solo se trae si se va a poder elegir uno.
    perm.puede('gestionar_contratos_conserjeria')
      ? traerTodo<ClienteOpt>((desde, hasta) => sb.from('empresas_usuarias')
          .select('id, nombre').eq('activo', true)
          .order('nombre').order('id').range(desde, hasta), { etiqueta: 'clientes' })
      : Promise.resolve([] as ClienteOpt[]),
  ])

  const contrato: ContratoFila = {
    id: g.id,
    codigo: g.codigo,
    nombre: g.nombre,
    descripcion: g.descripcion,
    objeto: g.objeto,
    numero: g.numero,
    cliente_id: g.cliente_id,
    cliente_nombre: g.cliente?.nombre ?? null,
    estado: (g.estado ?? 'BORRADOR') as EstadoContrato,
    vigencia_desde: g.vigencia_desde,
    vigencia_hasta: g.vigencia_hasta,
    idioma_reportes: g.idioma_reportes ?? 'es-CO',
    arte_color: g.arte_color,
    arte_logo_path: g.arte_logo_path,
    activo: g.activo ?? true,
    servicios: ((g.grupo_servicios ?? []) as { servicio: ServicioContrato; activo: boolean }[])
      .filter((s) => s.activo).map((s) => s.servicio),
    sedes: Number(g.sedes?.[0]?.count ?? 0),
  }

  const reglas: ReglasContrato = reglasFila ?? { grupo_id: id, ...REGLAS_POR_DEFECTO }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Link href="/rondas/contratos"
        className="inline-flex items-center gap-1 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="w-4 h-4" /> Contratos de conserjería
      </Link>

      <EditorContrato
        contrato={contrato}
        periodos={periodos}
        reglas={reglas}
        reglasExisten={!!reglasFila}
        clientes={clientes}
        puedeGestionar={perm.puede('gestionar_contratos_conserjeria')}
      />
    </div>
  )
}
