import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Gestión · Servicios del Hogar',
  robots: { index: false, follow: false },
}

export default function GestionHogarLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>
}
