import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { IngresarClient } from './IngresarClient'
import { FotoFondo, Velo } from '@/components/ui/FotoFondo'

export const metadata: Metadata = { title: 'Ingresar', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default function IngresarPage() {
  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Fondo desenfocado de un lobby: la pantalla de ingreso ya no es un
          rectángulo de color plano. */}
      <FotoFondo src="/images/ingresar-fondo.jpg" degradado={null} className="bg-brand-green-bg" />
      <Velo estilo="linear-gradient(160deg, rgba(240,247,240,.88) 0%, rgba(232,244,233,.94) 100%)" />
      <div className="relative z-10 w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center">
          <Image src="/logo-horizontal.png" alt="Conserjes Inmobiliarios" width={240} height={60} priority className="h-11 w-auto" />
        </Link>
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <IngresarClient />
        </div>
        <p className="mt-4 text-center text-sm text-gray-500">
          ¿Aún no te registras?{' '}
          <Link href="/registro-vacantes" className="font-semibold text-brand-green underline underline-offset-4">
            Trabaja con nosotros
          </Link>
        </p>
      </div>
    </div>
  )
}
