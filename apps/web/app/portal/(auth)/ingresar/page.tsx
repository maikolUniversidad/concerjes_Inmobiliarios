'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { IngresarPortalClient } from './IngresarPortalClient'

export default function IngresarPortalPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green">
            <span className="font-heading text-lg font-bold text-white">CI</span>
          </div>
          <span className="font-heading text-base font-bold text-brand-green">Conserjes Inmobiliarios</span>
        </Link>
        <div className="rounded-2xl bg-white p-6 shadow-lg ring-1 ring-gray-100">
          <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>}>
            <IngresarPortalClient />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
