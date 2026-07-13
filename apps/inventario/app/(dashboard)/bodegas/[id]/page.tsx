import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Pencil, LayoutTemplate } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { eliminarBodega } from '../actions'
import { BodegaPlano, type Ubic, type ProdMin } from './BodegaPlano'

export const metadata: Metadata = { title: 'Bodega' }
export const revalidate = 0

interface Props { params: Promise<{ id: string }> }

export default async function BodegaDetallePage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: bodega, error } = await supabase
    .from('bodegas')
    .select('id, nombre, codigo, direccion, descripcion, plano_url, responsable_id, responsable:usuarios!bodegas_responsable_id_fkey ( nombre )')
    .eq('id', id).single()
  if (error || !bodega) notFound()

  const [{ data: ubic }, { data: usuarios }, { data: prods }] = await Promise.all([
    supabase.from('ubicaciones')
      .select('id, codigo, nombre, tipo, descripcion, foto_url, pos_x, pos_y, responsable_id, responsable:usuarios!ubicaciones_responsable_id_fkey ( nombre )')
      .eq('bodega_id', id).eq('activo', true).order('codigo'),
    supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('productos').select('id, nombre_estandar, sku, ref, ubicacion_id').eq('activo', true).order('nombre_estandar'),
  ])

  const ubicaciones = ((ubic as unknown as (Omit<Ubic, 'responsable_nombre'> & { responsable: { nombre: string } | null })[]) ?? [])
    .map(u => ({ ...u, responsable_nombre: u.responsable?.nombre ?? null }))
  const productos = (prods as unknown as ProdMin[]) ?? []
  const b = bodega as unknown as { id: string; nombre: string; codigo: string | null; direccion: string | null; descripcion: string | null; plano_url: string | null; responsable: { nombre: string } | null }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/bodegas" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
            <ArrowLeft className="w-4 h-4" /> Bodegas
          </Link>
          <h1 className="font-heading font-bold text-2xl text-gray-900">{b.nombre}</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {b.codigo ? `Código ${b.codigo} · ` : ''}{b.direccion ?? 'Sin dirección'}{b.responsable ? ` · Responsable: ${b.responsable.nombre}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/bodegas/${id}/plano`} className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-3 py-2 rounded-xl hover:bg-brand-green-dark">
            <LayoutTemplate className="w-3.5 h-3.5" /> Diseñar plano
          </Link>
          <Link href={`/bodegas/${id}/editar`} className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-3 py-2 rounded-xl hover:bg-gray-50">
            <Pencil className="w-3.5 h-3.5" /> Editar bodega
          </Link>
          <DeleteButton action={eliminarBodega} id={id} mensaje={`¿Eliminar la bodega “${b.nombre}”? Sus ubicaciones también se ocultarán.`}
            className="flex items-center gap-2 border border-red-200 text-red-600 font-body text-sm px-3 py-2 rounded-xl hover:bg-red-50">
            Eliminar
          </DeleteButton>
        </div>
      </div>

      <BodegaPlano
        bodegaId={id}
        planoUrl={b.plano_url}
        ubicacionesIniciales={ubicaciones}
        productos={productos}
        usuarios={(usuarios as { id: string; nombre: string }[]) ?? []}
      />
    </div>
  )
}
