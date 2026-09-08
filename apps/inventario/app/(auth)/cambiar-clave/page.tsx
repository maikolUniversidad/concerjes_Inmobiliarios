import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CambiarClaveForm } from './CambiarClaveForm'

export const metadata: Metadata = { title: 'Cambiar contraseña' }
export const dynamic = 'force-dynamic'

export default async function CambiarClavePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // El correo sintético de los colaboradores de planta es `<cédula>@conserje.local`.
  // Se le pasa al formulario para prohibir que la contraseña nueva sea la cédula.
  const correo = user.email ?? ''
  const documento = String(user.user_metadata?.documento ?? correo.split('@')[0] ?? '')

  // Para saludar bien hace falta el nombre de pila, y la metadata de la cuenta
  // guarda el nombre como viene de nómina («APELLIDOS NOMBRES»): cortar por el
  // primer espacio daría el apellido. La ficha sí los tiene separados, y la
  // política `gh_persona_propia` deja que cada quien lea la suya.
  const { data: persona } = await supabase
    .from('personas')
    .select('nombres')
    .eq('usuario_id', user.id)
    .maybeSingle()

  const nombres = (persona as { nombres: string | null } | null)?.nombres ?? ''
  const nombre = nombres || String(user.user_metadata?.nombre ?? '')

  return (
    <CambiarClaveForm
      obligatorio={user.user_metadata?.debe_cambiar_password === true}
      correo={correo}
      documento={documento}
      nombre={nombre}
    />
  )
}
