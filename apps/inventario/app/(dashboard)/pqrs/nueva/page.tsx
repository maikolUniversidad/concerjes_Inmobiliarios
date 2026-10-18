import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type { SedePqrs, TipoPqrs } from '@/lib/pqrs'
import { FormularioPqrs } from './FormularioPqrs'

export const metadata: Metadata = { title: 'Radicar PQRS' }
export const dynamic = 'force-dynamic'

const ROLES_COORDINACION = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']

export default async function NuevaPqrsPage() {
  const perm = await requirePermiso('gestionar_pqrs')
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // `pqrs_sedes` ya filtra por alcance: el personal de sede solo ve la suya.
  const [{ data: sedes }, { data: plazos }] = await Promise.all([
    sb.rpc('pqrs_sedes'),
    sb.from('pqrs_plazos').select('tipo, dias_habiles'),
  ])

  const porTipo: Partial<Record<TipoPqrs, number>> = {}
  for (const p of (plazos ?? []) as { tipo: TipoPqrs; dias_habiles: number }[]) {
    porTipo[p.tipo] = Number(p.dias_habiles)
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/pqrs" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> PQRS
      </Link>
      <div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">Radicar PQRS</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Queda con número de radicado y fecha límite de respuesta desde el momento en que se guarda.
        </p>
      </div>
      <FormularioPqrs
        sedes={(sedes ?? []) as SedePqrs[]}
        plazos={porTipo}
        coordina={ROLES_COORDINACION.includes(perm.rol)}
      />
    </div>
  )
}
