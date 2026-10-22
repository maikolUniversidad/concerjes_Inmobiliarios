import { redirect } from 'next/navigation'
import { actorDeCampo } from '@/lib/campo/sesion'
import { EjecucionVisita } from '@/components/campo/EjecucionVisita'

// La ejecución de la visita.
//
// La página es un cascarón a propósito: la visita VIVE EN EL CELULAR
// (IndexedDB) hasta que la cola la sube, así que renderizarla en el servidor
// sería imposible en un sótano sin señal — que es el caso real, no el borde.
// Lo único que hace el servidor es decir quién está trabajando.
export const dynamic = 'force-dynamic'

export default async function VisitaCampoPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await actorDeCampo()
  if (!actor) redirect(`/campo/entrar?destino=${encodeURIComponent(`/campo/visita/${id}`)}`)

  return (
    <EjecucionVisita
      visitaId={id}
      actor={{
        personaId: actor.personaId,
        nombre: actor.personaNombre,
        modo: actor.metodo === 'CUENTA' ? 'cuenta' : 'sesion',
        sesionId: actor.sesionId,
      }}
    />
  )
}
