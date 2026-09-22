import type { Metadata } from 'next'
import { PruebasClient } from './PruebasClient'

export const metadata: Metadata = { title: 'Pruebas de selección · Registro de Vacantes' }
export const dynamic = 'force-dynamic'

export default function PruebasPage() {
  return <PruebasClient />
}
