import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { BodegaForm } from '../BodegaForm'

export const metadata: Metadata = { title: 'Nueva bodega' }

export default async function NuevaBodegaPage() {
  const supabase = await createClient()
  const { data: usuarios } = await supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre')

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/bodegas" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a bodegas
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Nueva bodega</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Registra una bodega y, opcionalmente, sube su plano</p>
      </div>
      <BodegaForm usuarios={usuarios ?? []} modo="crear" />
    </div>
  )
}
