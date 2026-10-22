import { redirect } from 'next/navigation'
import { actorDeCampo } from '@/lib/campo/sesion'
import { getAdmin } from '@/lib/supabase/admin'
import { CONSENTIMIENTOS, NECESARIOS } from '@/lib/campo/consentimientos'
import { InicioCampo } from '@/components/campo/InicioCampo'

// Pantalla de inicio de la PWA: escanear el QR o escribir el código impreso.
//
// Es el punto de entrada cuando la app ya está instalada. Quien llega por la
// placa entra por /q/<token>, que resuelve y verifica la firma (F2) y manda
// aquí o directo al punto.
export const dynamic = 'force-dynamic'

export default async function InicioCampoPage() {
  const actor = await actorDeCampo()
  if (!actor) redirect('/campo/entrar?destino=/campo')

  // Qué consentimientos faltan. Los necesarios se piden ANTES del primer uso;
  // la biometría se ofrece y se puede decir que no sin consecuencias.
  const sb = getAdmin()
  const { data } = await sb
    .from('persona_consentimientos')
    .select('tipo, otorgado, texto_version, revocado_at, created_at')
    .eq('persona_id', actor.personaId)
    .order('created_at', { ascending: false })

  const ultimo = new Map<string, { otorgado: boolean; version: string; revocado: boolean }>()
  for (const c of (data ?? []) as {
    tipo: string; otorgado: boolean; texto_version: string; revocado_at: string | null
  }[]) {
    if (!ultimo.has(c.tipo)) {
      ultimo.set(c.tipo, {
        otorgado: c.otorgado, version: c.texto_version, revocado: c.revocado_at != null,
      })
    }
  }
  const faltan = CONSENTIMIENTOS.filter((c) => {
    const u = ultimo.get(c.tipo)
    // Falta si nunca se preguntó, o si el texto cambió de versión (hay que
    // volver a preguntar: lo que aceptó ya no es lo que dice el texto de hoy).
    return !u || u.version !== c.version
  }).map((c) => c.tipo)

  const bloqueantes = faltan.filter((t) => NECESARIOS.includes(t))

  return (
    <InicioCampo
      actor={{
        personaId: actor.personaId,
        nombre: actor.personaNombre,
        modo: actor.metodo === 'CUENTA' ? 'cuenta' : 'sesion',
        sesionId: actor.sesionId,
      }}
      faltanConsentimientos={faltan}
      bloqueantes={bloqueantes}
    />
  )
}
