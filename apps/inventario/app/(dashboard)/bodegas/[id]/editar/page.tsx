import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { BodegaForm, type BodegaDefaults } from '../../BodegaForm'

export const metadata: Metadata = { title: 'Editar bodega' }

interface Props { params: Promise<{ id: string }> }

export default async function EditarBodegaPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data, error }, { data: usuarios }] = await Promise.all([
    supabase.from('bodegas').select('id, nombre, codigo, direccion, descripcion, plano_url, responsable_id').eq('id', id).single(),
    supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
  ])
  if (error || !data) notFound()

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href={`/bodegas/${id}`} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a la bodega
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Editar bodega</h1>
      </div>
      <BodegaForm usuarios={usuarios ?? []} defaults={data as unknown as BodegaDefaults} modo="editar" />
    </div>
  )
}
