'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { firmarRutas } from '@/lib/mantenimiento'

/** Muestra miniaturas de fotos guardadas en el bucket privado de mantenimiento. */
export function FotosFirmadas({ rutas, tam = 'h-16 w-16' }: { rutas: string[]; tam?: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const clave = rutas.join('|')

  useEffect(() => {
    if (!clave) return
    let vivo = true
    firmarRutas(createClient(), clave.split('|')).then((u) => { if (vivo) setUrls(u) })
    return () => { vivo = false }
  }, [clave])

  if (rutas.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {rutas.map((r) => urls[r] ? (
        <a key={r} href={urls[r]} target="_blank" rel="noopener noreferrer" className={`${tam} shrink-0 overflow-hidden rounded-lg border border-gray-100`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[r]} alt="Foto" className="h-full w-full object-cover" />
        </a>
      ) : (
        <span key={r} className={`${tam} shrink-0 rounded-lg bg-gray-100 animate-pulse`} />
      ))}
    </div>
  )
}
