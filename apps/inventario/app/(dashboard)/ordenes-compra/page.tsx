import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { rangoSemana } from '@/lib/semana'
import { FiltroSemana } from '@/components/filtros/FiltroSemana'
import { anularOC } from './actions'
import { OrdenesCompraTabla, type OCRow } from './OrdenesCompraTabla'

export const metadata: Metadata = { title: 'Órdenes de Compra' }
export const dynamic = 'force-dynamic'

export default async function OrdenesCompraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermiso('ver_ordenes_compra')
  const supabase = await createClient()
  const sp = await searchParams
  const semana = rangoSemana(typeof sp.semana === 'string' ? sp.semana : null)

  let query = supabase
    .from('ordenes_compra')
    .select('id, numero_oc, estado, periodo, fecha_emision, valor_total, proveedor:proveedores ( nombre )')
    .order('fecha_emision', { ascending: false })
    .limit(200)
  if (semana) query = query.gte('created_at', semana.desde).lt('created_at', semana.hasta)

  const { data } = await query
  const ordenes = (data as unknown as OCRow[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Órdenes de Compra</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">{ordenes.length} órdenes registradas</p>
        </div>
        <Link href="/ordenes-compra/nuevo" className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Nueva orden
        </Link>
      </div>

      <Suspense fallback={null}>
        <FiltroSemana />
      </Suspense>

      <OrdenesCompraTabla ordenes={ordenes} anularOC={anularOC} />
    </div>
  )
}
