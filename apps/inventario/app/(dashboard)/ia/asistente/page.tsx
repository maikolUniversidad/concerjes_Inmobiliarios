import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import type { IACarpeta, IAConversacion } from '@/lib/types/database'
import { AsistenteClient } from './AsistenteClient'

export const metadata: Metadata = { title: 'Asistente IA' }
export const dynamic = 'force-dynamic'

export default async function AsistentePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let carpetas: IACarpeta[] = []
  let conversaciones: IAConversacion[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let personas: any[] = []

  if (user) {
    const [{ data: c }, { data: cv }, { data: pe }] = await Promise.all([
      supabase.from('ia_carpetas').select('*').eq('user_id', user.id).order('orden'),
      supabase.from('ia_conversaciones').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
      supabase.from('personas').select('id, nombres, apellidos, documento, tipo_doc').order('apellidos'),
    ])
    carpetas = c ?? []
    conversaciones = cv ?? []
    personas = pe ?? []
  }

  return (
    // En móvil deja el hueco de la barra inferior (~4rem + safe-area); en desktop ocupa todo el alto.
    <div className="h-full pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <AsistenteClient
        userId={user?.id ?? ''}
        carpetasIniciales={carpetas}
        conversacionesIniciales={conversaciones}
        personas={personas}
      />
    </div>
  )
}
