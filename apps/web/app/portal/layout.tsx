import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portal de Clientes | Conserjes Inmobiliarios',
  description: 'Agenda servicios del hogar, haz seguimiento y gestiona tu perfil.',
  robots: { index: false, follow: false },
}

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-brand-green-bg/30">{children}</div>
}
