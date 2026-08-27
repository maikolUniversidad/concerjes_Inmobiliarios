import type { Metadata } from 'next'
import { TiendaClient } from './TiendaClient'

export const metadata: Metadata = {
  title: 'Tienda de Servicios del Hogar',
  description: 'Explora todos los servicios del hogar con fotos y video, conoce a los concerjes disponibles y agenda en minutos. Sin registro para ver.',
}

export default function TiendaHogarPage() {
  return <TiendaClient />
}
