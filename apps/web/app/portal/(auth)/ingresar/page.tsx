'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import { IngresarPortalClient } from './IngresarPortalClient'
import { FotoFondo, Velo } from '@/components/ui/FotoFondo'

export default function IngresarPortalPage() {
  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Mismo fondo desenfocado que el ingreso administrativo, para que las dos
          puertas de entrada se sientan del mismo sitio. */}
      <FotoFondo src="/images/ingresar-fondo.jpg" degradado={null} className="bg-brand-green-bg" />
      <Velo estilo="linear-gradient(160deg, rgba(240,247,240,.88) 0%, rgba(232,244,233,.94) 100%)" />
      <div className="relative z-10 w-full max-w-sm">
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
