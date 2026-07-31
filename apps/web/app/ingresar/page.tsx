import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { IngresarClient } from './IngresarClient'

export const metadata: Metadata = { title: 'Ingresar', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default function IngresarPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-green-bg/40 px-4 py-10">
      <div className="w-full max-w-sm">
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
