import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PlanoDesigner } from './PlanoDesigner'
import type { PlanoPiso } from './plano-tipos'

export const metadata: Metadata = { title: 'Diseñador de plano' }
export const revalidate = 0

interface Props { params: Promise<{ id: string }> }

export default async function PlanoPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: bodega, error } = await supabase
    .from('bodegas').select('id, nombre, codigo').eq('id', id).single()
  if (error || !bodega) notFound()

  const [{ data: pisosData }, { data: ubicData }] = await Promise.all([
    supabase.from('bodega_pisos')
      .select('id, bodega_id, numero, nombre, ancho_m, alto_m, escala, fondo_url, elementos, orden')
      .eq('bodega_id', id).order('numero'),
    supabase.from('ubicaciones')
      .select('id, codigo, nombre').eq('bodega_id', id).eq('activo', true).order('codigo'),
  ])

  let pisos = (pisosData as unknown as PlanoPiso[]) ?? []

  // Garantiza que la bodega tenga al menos un piso (ligado a ESTA bodega),
  // aunque se haya creado después de la migración/seed.
  if (pisos.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: nuevo } = await (supabase as any)
      .from('bodega_pisos')
      .upsert(
        { bodega_id: id, numero: 1, nombre: 'Planta baja', ancho_m: 20, alto_m: 15, escala: 40, elementos: [] },
        { onConflict: 'bodega_id,numero' },
      )
      .select('id, bodega_id, numero, nombre, ancho_m, alto_m, escala, fondo_url, elementos, orden')
      .single()
    if (nuevo) pisos = [nuevo as unknown as PlanoPiso]
  }

  const ubicaciones = (ubicData as unknown as { id: string; codigo: string; nombre: string | null }[]) ?? []
  const b = bodega as unknown as { id: string; nombre: string; codigo: string | null }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <Link href={`/bodegas/${id}`} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a la bodega
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Diseñador de plano · {b.nombre}</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Dibuja el plano a escala real: estantes, zonas, puertas, escaleras y más. Soporta varios pisos.
        </p>
      </div>

      <PlanoDesigner bodegaId={id} pisosIniciales={pisos} ubicaciones={ubicaciones} />
    </div>
  )
}
