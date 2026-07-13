import type { Metadata } from 'next'
import Link from 'next/link'
import { Warehouse, Plus, MapPin, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { PlanoThumb } from './PlanoThumb'
import type { PlanoElemento } from './[id]/plano/plano-tipos'

export const metadata: Metadata = { title: 'Bodegas' }
export const revalidate = 0

interface BodegaRow {
  id: string; nombre: string; codigo: string | null; direccion: string | null
  plano_url: string | null
  responsable: { nombre: string } | null
  ubicaciones: { count: number }[]
}

export default async function BodegasPage() {
  await requirePermiso('ver_bodegas')
  const supabase = await createClient()
  const { data } = await supabase
    .from('bodegas')
    .select('id, nombre, codigo, direccion, plano_url, responsable:usuarios!bodegas_responsable_id_fkey ( nombre ), ubicaciones ( count )')
    .eq('activo', true)
    .order('nombre')

  const bodegas = (data as unknown as BodegaRow[]) ?? []

  // Miniatura del plano: primer piso con elementos por bodega
  type PisoRow = { bodega_id: string; numero: number; ancho_m: number; alto_m: number; elementos: PlanoElemento[] }
  const { data: pisosData } = await supabase
    .from('bodega_pisos')
    .select('bodega_id, numero, ancho_m, alto_m, elementos')
    .in('bodega_id', bodegas.map(b => b.id).length ? bodegas.map(b => b.id) : ['—'])
    .order('numero')
  const planoPorBodega = new Map<string, PisoRow>()
  for (const p of ((pisosData as unknown as PisoRow[]) ?? [])) {
    if ((p.elementos?.length ?? 0) > 0 && !planoPorBodega.has(p.bodega_id)) planoPorBodega.set(p.bodega_id, p)
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
            <Warehouse className="w-6 h-6 text-brand-green" /> Bodegas y Ubicaciones
          </h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Clasificación física: plano de cada bodega, estanterías con foto y responsables.
          </p>
        </div>
        <Link href="/bodegas/nuevo" className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Nueva bodega
        </Link>
      </div>

      {bodegas.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <Warehouse className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">No hay bodegas</p>
          <Link href="/bodegas/nuevo" className="inline-block mt-3 text-brand-green font-body font-semibold text-sm hover:underline">Crear la primera →</Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bodegas.map(b => (
            <Link key={b.id} href={`/bodegas/${b.id}`} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-brand-green/30 transition-all">
              <div className="aspect-video bg-gray-50 relative flex items-center justify-center p-2">
                {planoPorBodega.has(b.id)
                  ? <PlanoThumb {...planoPorBodega.get(b.id)!} />
                  : b.plano_url
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={b.plano_url} alt={b.nombre} className="object-cover w-full h-full rounded" />
                    : <Warehouse className="w-10 h-10 text-gray-300" />}
                {b.codigo && <span className="absolute top-2 left-2 bg-white/90 font-mono text-xs px-2 py-0.5 rounded">{b.codigo}</span>}
              </div>
              <div className="p-4">
                <h3 className="font-heading font-bold text-base text-gray-900">{b.nombre}</h3>
                {b.direccion && <p className="font-body text-xs text-gray-400 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> {b.direccion}</p>}
                <div className="flex items-center justify-between mt-3 font-body text-xs text-gray-500">
                  <span>{b.ubicaciones?.[0]?.count ?? 0} ubicaciones</span>
                  {b.responsable && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {b.responsable.nombre}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
