import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { MovimientoForm } from './MovimientoForm'

export const metadata: Metadata = { title: 'Registrar movimiento' }

export default async function NuevoMovimientoPage() {
  const supabase = await createClient()

  const [{ data: productos }, { data: sedes }] = await Promise.all([
    supabase.from('productos').select('id, nombre_estandar, presentacion').eq('activo', true).order('nombre_estandar'),
    supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/movimientos" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a movimientos
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Registrar movimiento</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          El stock se actualiza automáticamente según el tipo de movimiento
        </p>
      </div>

      <MovimientoForm productos={productos ?? []} sedes={sedes ?? []} />
    </div>
  )
}
