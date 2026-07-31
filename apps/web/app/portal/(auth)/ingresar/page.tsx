'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import { IngresarPortalClient } from './IngresarPortalClient'

export default function IngresarPortalPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center">
          <Image src="/logo-horizontal.png" alt="Conserjes Inmobiliarios" width={240} height={60} priority className="h-11 w-auto" />
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
