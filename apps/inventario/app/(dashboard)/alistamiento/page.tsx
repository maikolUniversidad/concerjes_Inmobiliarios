import type { Metadata } from 'next'
import Link from 'next/link'
import { PackageCheck, MapPin, ArrowRight, Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'

export const metadata: Metadata = { title: 'Alistamiento' }
export const revalidate = 0

/** Estados que YA pasaron la aprobación de la central y viven en bodega. */
const ESTADOS_ALISTAMIENTO = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO']

const META: Record<string, { label: string; color: string }> = {
  APROBADA:        { label: 'Lista para alistar', color: 'bg-blue-100 text-blue-700' },
  EN_ALISTAMIENTO: { label: 'En alistamiento',    color: 'bg-violet-100 text-violet-700' },
  ALISTADO:        { label: 'Alistado',           color: 'bg-teal-100 text-teal-700' },
  DESPACHADO:      { label: 'Despachado',         color: 'bg-green-100 text-green-700' },
}

interface Fila {
  id: string; numero: string; estado: string; created_at: string; aprobado_at: string | null
  sede: { nombre: string } | null
  items: { alistado: boolean }[]
}

export default async function AlistamientoPage() {
  await requirePermiso('ver_alistamiento')
  const supabase = await createClient()

  const { data } = await supabase
    .from('ordenes_insumo')
    .select('id, numero, estado, created_at, aprobado_at, sede:sede_id ( nombre ), items:orden_insumo_items ( alistado )')
    .in('estado', ESTADOS_ALISTAMIENTO)
    .order('aprobado_at', { ascending: false, nullsFirst: false })

  const ordenes = (data as unknown as Fila[]) ?? []
  const pendientes = ordenes.filter(o => o.estado !== 'DESPACHADO')

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <PackageCheck className="w-6 h-6 text-brand-green" /> Alistamiento
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Órdenes de insumo <strong>ya aprobadas</strong> por la central. Aquí bodega alista y despacha.
          {pendientes.length > 0 && ` · ${pendientes.length} por trabajar`}
        </p>
      </div>

      {ordenes.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">No hay órdenes aprobadas</p>
          <p className="font-body text-sm mt-1">
            Las órdenes aparecen aquí cuando la central aprueba la propuesta del coordinador de sede.
          </p>
          <Link href="/ordenes-insumo" className="inline-block mt-3 text-brand-green font-body font-semibold text-sm hover:underline">
            Ver órdenes de insumo →
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ordenes.map(o => {
            const m = META[o.estado] ?? { label: o.estado, color: 'bg-gray-100 text-gray-600' }
            const total = o.items?.length ?? 0
            const listos = (o.items ?? []).filter(i => i.alistado).length
            const pct = total > 0 ? Math.round((listos / total) * 100) : 0
            return (
              <Link key={o.id} href={`/ordenes-insumo/${o.id}`}
                className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-brand-green/40 hover:shadow transition-all group">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading font-bold text-base text-gray-900">{o.numero}</span>
                  <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.color}`}>{m.label}</span>
                </div>
                <p className="font-body text-xs text-gray-500 mt-1 flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> {o.sede?.nombre ?? 'Sin sede'}
                </p>

                <div className="mt-3">
                  <div className="flex items-center justify-between font-body text-xs text-gray-500 mb-1">
                    <span>Alistamiento</span><span>{listos}/{total} ítems</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-brand-green rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <span className="mt-3 inline-flex items-center gap-1 font-body text-xs font-semibold text-brand-green">
                  {o.estado === 'DESPACHADO' ? <><Truck className="w-3.5 h-3.5" /> Ver despacho</> : <>Abrir alistamiento <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" /></>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
