import { FormaEntrar } from '@/components/campo/FormaEntrar'

// Identidad de quien NO tiene cuenta (ADR-A, decisión §1.2): documento →
// enlace de un uso + PIN al canal verificado.
//
// Quien SÍ tiene cuenta no pasa por aquí: entra por /ingresar como siempre y
// /campo lo reconoce. Esta pantalla es para las ~5.700 personas que no tienen
// fila en `usuarios`.
export const dynamic = 'force-dynamic'

export default async function EntrarCampoPage({
  searchParams,
}: { searchParams: Promise<{ t?: string; destino?: string; punto?: string }> }) {
  const { t, destino, punto } = await searchParams
  return (
    <FormaEntrar
      tokenInicial={t ?? null}
      destino={destino ?? '/campo'}
      punto={punto ?? null}
    />
  )
}
