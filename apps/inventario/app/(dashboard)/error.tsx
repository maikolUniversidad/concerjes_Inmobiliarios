'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw, LifeBuoy } from 'lucide-react'

/**
 * Red de seguridad de todo el panel: si una pantalla falla al cargar o una
 * acción lanza un error que nadie atrapó, se muestra esto DENTRO del panel (con
 * el menú) en lugar de la pantalla en blanco de Next "This page couldn't load".
 * En producción Next oculta el mensaje real; el código (digest) sirve para
 * ubicar el error en los registros de Vercel.
 */
export default function ErrorDelPanel({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[panel]', error)
  }, [error])

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <p className="flex items-center gap-2 font-heading text-lg font-semibold text-amber-900">
          <AlertTriangle className="h-5 w-5" /> Esta pantalla no se pudo cargar
        </p>
        <p className="mt-2 font-body text-sm text-amber-900/90">
          Ocurrió un error en el servidor. Tus datos no se perdieron: intenta de nuevo. Si vuelve a pasar,
          repórtalo en Soporte con el código de abajo.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-amber-800/80">Código: {error.digest}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => unstable_retry()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 font-body text-sm font-semibold text-white hover:bg-brand-green-dark"
          >
            <RotateCw className="h-4 w-4" /> Reintentar
          </button>
          <Link
            href="/soporte"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-4 py-2 font-body text-sm text-amber-900 hover:bg-amber-100"
          >
            <LifeBuoy className="h-4 w-4" /> Ir a Soporte
          </Link>
        </div>
      </div>
    </div>
  )
}
