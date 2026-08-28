import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, MailPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { cargarCuenta, motivoNoEnvia } from '@/lib/email/transport'
import type { PlantillaCorreo } from '@/lib/types/database'
import { PlantillasClient } from './PlantillasClient'

export const metadata: Metadata = { title: 'Plantillas de correo' }
export const revalidate = 0

export default async function PlantillasPage() {
  await requirePermiso('gestionar_plantillas_correo')
  const supabase = await createClient()

  const { data: plantillas } = await supabase
    .from('plantillas_correo')
    .select('*')
    .order('categoria', { ascending: true })
    .order('nombre', { ascending: true })

  const cuenta = await cargarCuenta(supabase)

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <Link href="/notificaciones" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Notificaciones
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <MailPlus className="w-6 h-6 text-brand-green" /> Plantillas de correo
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Escribe el correo una vez, con variables entre llaves, y reutilízalo desde los flujos de notificación.
          También puedes subir un archivo HTML diseñado aparte.
        </p>
      </div>

      <PlantillasClient
        plantillas={(plantillas as PlantillaCorreo[]) ?? []}
        avisoCorreo={motivoNoEnvia(cuenta)}
      />
    </div>
  )
}
