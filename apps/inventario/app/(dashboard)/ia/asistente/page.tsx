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

  if (user) {
    const [{ data: c }, { data: cv }] = await Promise.all([
      supabase.from('ia_carpetas').select('*').eq('user_id', user.id).order('orden'),
      supabase.from('ia_conversaciones').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
    ])
    carpetas = c ?? []
    conversaciones = cv ?? []
  }

  return (
    <div className="h-full">
      <AsistenteClient
        userId={user?.id ?? ''}
        carpetasIniciales={carpetas}
        conversacionesIniciales={conversaciones}
      />
    </div>
  )
}
