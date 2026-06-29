import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ArqueoClient, type ArqueoHeader, type ItemRow } from './ArqueoClient'

export const metadata: Metadata = { title: 'Arqueo' }
export const revalidate = 0

interface Props { params: Promise<{ id: string }> }

interface RawItem {
  id: string
  producto_id: string
  cantidad_sistema: number
  cantidad_fisica: number | null
  estado: 'PENDIENTE' | 'CONTADO' | 'AJUSTADO'
  observacion: string | null
  contado_por_nombre: string | null
  precio_lista: number | null
  producto: { ref: number | null; nombre_estandar: string; presentacion: string | null } | null
}

export default async function ArqueoDetallePage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: arqueoData, error } = await supabase
    .from('arqueos')
    .select('id, nombre, descripcion, estado, valor_diferencia, cerrado_at')
    .eq('id', id).single()
  if (error || !arqueoData) notFound()

  const [{ data: itemsData }, { data: { user } }] = await Promise.all([
    supabase.from('arqueo_items')
      .select('id, producto_id, cantidad_sistema, cantidad_fisica, estado, observacion, contado_por_nombre, precio_lista, producto:productos ( ref, nombre_estandar, presentacion )')
      .eq('arqueo_id', id),
    supabase.auth.getUser(),
  ])

  let nombre = user?.email ?? 'Usuario'
  if (user) {
    const { data: u } = await supabase.from('usuarios').select('nombre').eq('id', user.id).single()
    nombre = (u as { nombre: string } | null)?.nombre ?? nombre
  }

  const items: ItemRow[] = ((itemsData as unknown as RawItem[]) ?? [])
    .map(i => ({
      id: i.id, producto_id: i.producto_id,
      ref: i.producto?.ref ?? null,
      nombre: i.producto?.nombre_estandar ?? '—',
      presentacion: i.producto?.presentacion ?? null,
      cantidad_sistema: Number(i.cantidad_sistema),
      cantidad_fisica: i.cantidad_fisica === null ? null : Number(i.cantidad_fisica),
      estado: i.estado, observacion: i.observacion,
      contado_por_nombre: i.contado_por_nombre, precio_lista: i.precio_lista,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const arqueo = arqueoData as unknown as ArqueoHeader

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Link href="/arqueo" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="w-4 h-4" /> Volver a arqueos
      </Link>
      <ArqueoClient arqueo={arqueo} itemsIniciales={items} usuario={{ id: user?.id ?? '', nombre }} />
    </div>
  )
}
