'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Una tabla a escuchar. En forma de objeto se le puede poner un `filtro` que
 * Realtime aplica EN EL SERVIDOR (sintaxis de `postgres_changes`, p. ej.
 * `orden_id=eq.<uuid>`), así la pestaña no recibe —ni paga la revisión de RLS
 * de— los cambios que no le importan. Sin filtro llega todo cambio de la tabla,
 * que es lo correcto para una pantalla de lista pero un desperdicio en una
 * pantalla de detalle.
 */
export type TablaEnVivo =
  | string
  | {
      tabla: string
      filtro?: string
      /**
       * Evento al que suscribirse; por defecto todos (`*`).
       *
       * Sirve para un detalle importante de los filtros: con REPLICA IDENTITY
       * DEFAULT, en un DELETE Realtime solo conoce las columnas de la llave
       * primaria, así que un filtro por OTRA columna no se puede evaluar y el
       * evento se descarta. Quien necesite los DELETE y filtre por algo que no
       * es la PK, añade una segunda entrada con `evento: 'DELETE'` y sin filtro:
       * el camino caliente (los UPDATE) queda filtrado y los DELETE, que son
       * mucho más raros, siguen llegando.
       */
      evento?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'
    }

/**
 * Suscripción Realtime (postgres_changes) a una o varias tablas. Ante cualquier
 * cambio llama `alCambiar` —o `router.refresh()` si no se pasa— con un
 * debounce, para que una ráfaga (p. ej. aprobar una orden de 200 ítems, que
 * recalcula 200 filas de stock) produzca UN solo refresco.
 *
 * Las tablas deben estar en la publicación `supabase_realtime`. Realtime
 * respeta la RLS: cada usuario solo recibe eventos de filas que puede leer.
 *
 * OJO con el costo: esa revisión de RLS sobre el WAL es el mayor consumidor de
 * la base (1,3 millones de ejecuciones y 2,7 h de CPU acumuladas), y se paga
 * por cada cambio y por cada pestaña suscrita. De ahí las dos reglas de uso:
 * en pantallas de detalle, pasar `filtro` para que el servidor descarte lo
 * demás; y `router.refresh()` —que vuelve a correr TODA la página de servidor—
 * solo donde de verdad cambia la página entera.
 */
export function useEnVivo(tablas: readonly TablaEnVivo[], alCambiar?: () => void, esperaMs = 2500) {
  const router = useRouter()
  const cb = useRef(alCambiar)
  cb.current = alCambiar
  // Clave estable para el efecto: las llamadas pasan el arreglo en línea, así
  // que su identidad cambia en cada render. Va como JSON y no concatenada
  // porque un filtro puede traer comas (`producto_id=in.(a,b)`).
  const clave = JSON.stringify(
    tablas.map((t) =>
      typeof t === 'string' ? [t, null, '*'] : [t.tabla, t.filtro ?? null, t.evento ?? '*'],
    ),
  )

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
    let canal = sb.channel(`en-vivo:${Math.random().toString(36).slice(2, 8)}`)
    for (const [tabla, filtro, evento] of JSON.parse(clave) as [string, string | null, string][]) {
      canal = canal.on(
        'postgres_changes',
        { event: evento, schema: 'public', table: tabla, ...(filtro ? { filter: filtro } : {}) },
        disparar,
      )
    }
    canal.subscribe()
    return () => {
      if (t) clearTimeout(t)
      sb.removeChannel(canal)
    }
  }, [clave, esperaMs, router])
}
