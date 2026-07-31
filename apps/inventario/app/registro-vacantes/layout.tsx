import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Registro de Vacantes',
  description:
    'Regístrate para trabajar con Conserjes Inmobiliarios Ltda. Llena tu hoja de vida desde tu celular en pocos minutos.',
  robots: { index: true, follow: true },
}

export default function RegistroLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-green-bg/40">
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center">
            <Image
              src="/logo-horizontal.png"
              alt="Conserjes Inmobiliarios"
              width={160}
              height={45}
              className="h-9 w-auto sm:h-10"
              priority
            />
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-500 hover:text-brand-green">
            Volver al sitio
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">{children}</main>
    </div>
  )
}
