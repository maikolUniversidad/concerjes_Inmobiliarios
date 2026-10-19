import { redirect } from 'next/navigation'
import { actorDeCampo } from '@/lib/campo/sesion'
import { ColaCampo } from '@/components/campo/ColaCampo'

// Lo que falta por enviar.
//
// El ADR-D lo pide explícito: «hay que mostrar la cola y poder descartar con
// motivo», porque puede haber visitas pendientes días. Una ronda que no sube y
// que nadie ve es peor que una que no se hizo: el trabajo está hecho y nadie lo
// sabe.
export const dynamic = 'force-dynamic'

export default async function ColaCampoPage() {
  const actor = await actorDeCampo()
  if (!actor) redirect('/campo/entrar?destino=/campo/cola')
  return <ColaCampo modo={actor.metodo === 'CUENTA' ? 'cuenta' : 'sesion'} />
}
