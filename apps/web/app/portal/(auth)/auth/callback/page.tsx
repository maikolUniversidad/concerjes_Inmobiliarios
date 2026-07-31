'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, AlertCircle } from 'lucide-react'
import { getPortalSupabase, asegurarCliente } from '@/lib/supabase/portal'

export default function PortalAuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    async function finalizar() {
      const sb = getPortalSupabase()
      // detectSessionInUrl resuelve el hash/código del redirect; damos margen y
      // confirmamos que ya haya sesión.
      for (let i = 0; i < 20; i++) {
        const { data } = await sb.auth.getSession()
        if (data.session) {
          await asegurarCliente()
          if (!cancelado) router.replace('/portal')
          return
        }
        await new Promise((r) => setTimeout(r, 150))
      }
      if (!cancelado) setError('No pudimos completar el inicio de sesión. Intenta de nuevo.')
    }
    finalizar()
    return () => { cancelado = true }
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
            <p className="mt-3 text-gray-700">{error}</p>
            <Link href="/portal/ingresar" className="mt-4 inline-block font-semibold text-brand-green underline underline-offset-4">
              Volver a intentar
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-green" />
            <p className="mt-3 text-gray-600">Iniciando sesión…</p>
          </>
        )}
      </div>
    </div>
  )
}
