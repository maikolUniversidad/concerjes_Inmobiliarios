'use client'

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { SolicitarPortal } from './SolicitarPortal'

export default function SolicitarPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>}>
      <SolicitarPortal />
    </Suspense>
  )
}
