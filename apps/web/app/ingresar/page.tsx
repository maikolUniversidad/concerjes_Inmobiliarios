import type { Metadata } from 'next'
import Link from 'next/link'
import { IngresarClient } from './IngresarClient'

export const metadata: Metadata = { title: 'Ingresar', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default function IngresarPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-green-bg/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green">
            <span className="font-heading text-lg font-bold text-white">CI</span>
          </div>
          <span className="font-heading text-base font-bold text-brand-green">Conserjes Inmobiliarios</span>
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
