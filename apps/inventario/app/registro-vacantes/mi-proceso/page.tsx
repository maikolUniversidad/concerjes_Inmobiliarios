import type { Metadata } from 'next'
import { MiProcesoClient } from './MiProcesoClient'

export const metadata: Metadata = { title: 'Mi proceso · Registro de Vacantes' }
export const dynamic = 'force-dynamic'

export default function MiProcesoPage() {
  return <MiProcesoClient />
}
