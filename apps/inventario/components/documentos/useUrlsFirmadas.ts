'use client'

import { useEffect, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * URLs firmadas de vida corta para varios archivos de un bucket privado, en
 * una sola petición. Devuelve { ruta: url }; mientras cargan, el mapa está vacío.
 */
export function useUrlsFirmadas(
  sb: any, rutas: (string | null | undefined)[], bucket = 'registro-vacantes', segundos = 1800,
): Record<string, string> {
  const clave = [...new Set(rutas.filter((r): r is string => !!r))].sort().join('|')
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const lista = clave ? clave.split('|') : []
    if (lista.length === 0) { setUrls({}); return }
    let vivo = true
    sb.storage.from(bucket).createSignedUrls(lista, segundos).then(({ data }: { data: { path: string | null; signedUrl: string | null }[] | null }) => {
      if (!vivo) return
      const mapa: Record<string, string> = {}
      for (const x of data ?? []) if (x.path && x.signedUrl) mapa[x.path] = x.signedUrl
      setUrls(mapa)
    })
    return () => { vivo = false }
  }, [sb, clave, bucket, segundos])

  return urls
}
