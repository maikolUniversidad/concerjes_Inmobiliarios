'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Suscripción Realtime (postgres_changes) a una o varias tablas. Ante cualquier
 * cambio llama `alCambiar` —o `router.refresh()` si no se pasa— con un
 * debounce, para que una ráfaga (p. ej. aprobar una orden de 200 ítems, que
 * recalcula 200 filas de stock) produzca UN solo refresco.
 *
 * Las tablas deben estar en la publicación `supabase_realtime` (stock,
 * ordenes_insumo y orden_insumo_items lo están desde 20260928100000). Realtime
 * respeta la RLS: cada usuario solo recibe eventos de filas que puede leer.
 */
export function useEnVivo(tablas: readonly string[], alCambiar?: () => void, esperaMs = 1200) {
  const router = useRouter()
  const cb = useRef(alCambiar)
  cb.current = alCambiar
  const clave = tablas.join(',')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    let t: ReturnType<typeof setTimeout> | null = null
    const disparar = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        if (cb.current) cb.current()
        else router.refresh()
      }, esperaMs)
    }
    let canal = sb.channel(`en-vivo:${clave}:${Math.random().toString(36).slice(2, 8)}`)
    for (const tabla of clave.split(',')) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, disparar)
    }
    canal.subscribe()
    return () => {
      if (t) clearTimeout(t)
      sb.removeChannel(canal)
    }
  }, [clave, esperaMs, router])
}
