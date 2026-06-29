import type { Metadata } from 'next'
import { HeroSection } from '@/components/sections/HeroSection'
import { ServicesSection } from '@/components/sections/ServicesSection'
import { StatsSection } from '@/components/sections/StatsSection'
import { AboutSection } from '@/components/sections/AboutSection'
import { ClientsSection } from '@/components/sections/ClientsSection'
import { CTASection } from '@/components/sections/CTASection'

export const metadata: Metadata = {
  title: 'Inicio',
  description:
    'Conserjes Inmobiliarios Ltda — 36 años ofreciendo servicios de aseo, cafetería, conserjería y mantenimiento en Colombia. Más de 1.069 colaboradores a su servicio.',
}

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <ServicesSection />
      <StatsSection />
      <AboutSection />
      <ClientsSection />
      <CTASection />
    </>
  )
}
