import { Suspense } from 'react'
import { RegistroWizard } from './RegistroWizard'

export const dynamic = 'force-dynamic'

export default function RegistroVacantesPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-gray-500">Cargando…</div>}>
      <RegistroWizard />
    </Suspense>
  )
}
